/**
 * dsh-balance-meter host service — the `balance.*` RPC domain. Resolves the DeepSeek
 * API key through the DSH credentials seam (`ctx.credentials`, ref
 * `DEEPSEEK_API_KEY`) and queries the official Get User Balance endpoint,
 * caching the result so the browser readout can poll without spamming the
 * provider.
 * @module dsh-balance-meter/service
 */
import { Service } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { resolveCostConfig, costOfUsage, costOfTokens, FLASH_COST_CONFIG, PRO_COST_CONFIG, } from "./cost.js";
import { fetchPricing, isPeakHour } from "./pricing.js";
/** DeepSeek API base URL. */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
/** Default credential reference for the DeepSeek API key. */
export const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY';
/** Default provider query pacing. */
export const DEFAULT_REFRESH_INTERVAL_SECONDS = 30;
/** Default hours between automatic official-pricing refreshes. */
export const DEFAULT_PRICING_REFRESH_HOURS = 6;
/** Official peak-pricing rollout: 2026-08-17 00:00 Beijing time (UTC+8). */
export const PEAK_PRICING_START_MS = Date.UTC(2026, 7, 16, 16, 0, 0);
/** SSRF / length guard for the base URL. */
const MAX_BASE_URL_LENGTH = 256;
/** Parse a base URL into a safe `{ origin, pathPrefix }` pair. */
function parseBaseUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new Error(`dsh-balance-meter: invalid baseUrl "${raw}"`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error(`dsh-balance-meter: baseUrl must be http(s), got "${url.protocol}"`);
    }
    let prefix = url.pathname.replace(/\/+$/, '');
    let origin = url.origin;
    return { origin, prefix };
}
/**
 * DeepSeek Get User Balance client. Resolution of the API key re-reads the
 * credentials seam on every query so a changed key reaches the next query
 * without a plugin restart.
 */
export class BalanceService extends Service {
    apiKeyEnv;
    baseUrl;
    refreshIntervalMs;
    model;
    costConfig;
    pricingSnapshot;
    pricingTimer;
    cached;
    cachedAt = 0;
    inflight;
    enabled;
    constructor(ctx, config = {}) {
        super(ctx, 'balance');
        this.apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
        this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
        this.refreshIntervalMs = Math.max(0, (config.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS) * 1_000);
        this.model = config.model ?? 'flash';
        this.costConfig = this.resolveCostFromPreset(config);
        this.enabled = config.enabled ?? true;
        // Refresh pricing once at boot, then on a slow cadence (6h) so a price
        // change or the peak-pricing rollout is picked up without a restart.
        void this.refreshPricing();
        const cadenceMs = (config.pricingRefreshHours ?? DEFAULT_PRICING_REFRESH_HOURS) * 3_600_000;
        this.pricingTimer = setInterval(() => { void this.refreshPricing(); }, cadenceMs);
        this.pricingTimer.unref?.();
    }
    /** Resolve the cost config from the model preset + explicit overrides. */
    resolveCostFromPreset(config) {
        const preset = this.model === 'pro' ? PRO_COST_CONFIG : FLASH_COST_CONFIG;
        return resolveCostConfig({
            inputPerMillion: config.cost?.inputPerMillion ?? preset.inputPerMillion,
            cacheReadPerMillion: config.cost?.cacheReadPerMillion ?? preset.cacheReadPerMillion,
            cacheWritePerMillion: config.cost?.cacheWritePerMillion ?? preset.cacheWritePerMillion,
            outputPerMillion: config.cost?.outputPerMillion ?? preset.outputPerMillion,
            currency: config.cost?.currency ?? preset.currency,
        });
    }
    /** Whether the balance service answers queries while enabled. */
    isEnabled() {
        return this.enabled;
    }
    /** Master switch: stop answering fresh provider queries (cache may still read). */
    setEnabled(enabled) {
        this.enabled = enabled;
    }
    /**
     * RPC: most recent balance + usage view. Returns the cached view when it is
     * still fresh, otherwise re-queries the provider (deduped when concurrent).
     */
    async view() {
        if (!this.enabled)
            return { fetchedAt: Date.now(), available: false, balances: [], error: 'disabled' };
        const now = Date.now();
        if (this.cached !== undefined && now - this.cachedAt < this.refreshIntervalMs && this.refreshIntervalMs > 0) {
            return this.cached;
        }
        if (this.inflight !== undefined)
            return this.inflight;
        this.inflight = this.query().then((view) => {
            this.cached = view;
            this.cachedAt = Date.now();
            return view;
        }).finally(() => {
            this.inflight = undefined;
        });
        return this.inflight;
    }
    /** RPC: force a fresh provider query (bypasses the cache window). */
    async refresh() {
        const view = await this.query();
        this.cached = view;
        this.cachedAt = Date.now();
        return view;
    }
    /**
     * RPC: current session token usage + estimated cost. Reads the official
     * `tokenUsage` projection (registered by dsh-token-meter) through the
     * session-projection registry and applies the configured per-million
     * prices. Returns zeroed values when the projection is unavailable.
     * @param session - the session whose usage is read.
     */
    sessionCost(session) {
        const registry = this.ctx.get('sessionProjections');
        let usage;
        if (registry !== undefined) {
            const value = registry.snapshot(session).values.tokenUsage;
            if (value !== null && typeof value === 'object')
                usage = value;
        }
        const zero = {
            uncachedInputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
        };
        const buckets = usage ?? zero;
        const config = this.effectiveCostConfig();
        const cost = costOfUsage({
            inputTokens: buckets.uncachedInputTokens,
            outputTokens: buckets.outputTokens,
            cacheReadTokens: buckets.cacheReadTokens,
            cacheWriteTokens: buckets.cacheWriteTokens,
        }, config);
        return {
            ...buckets,
            cost,
            currency: config.currency,
            breakdown: {
                input: costOfTokens(buckets.uncachedInputTokens, config.inputPerMillion),
                cacheRead: costOfTokens(buckets.cacheReadTokens, config.cacheReadPerMillion),
                cacheWrite: costOfTokens(buckets.cacheWriteTokens, config.cacheWritePerMillion),
                output: costOfTokens(buckets.outputTokens, config.outputPerMillion),
            },
        };
    }
    /**
     * The cost config in effect right now: auto-fetched official prices when
     * available (peak table applied by the current Beijing-hour band once the
     * peak rollout is live), otherwise the configured preset.
     */
    effectiveCostConfig() {
        const snapshot = this.pricingSnapshot;
        if (snapshot !== undefined && snapshot.error === undefined) {
            const prices = snapshot.current[this.model];
            let cacheRead = prices.cacheReadPerMillion;
            let input = prices.inputPerMillion;
            let output = prices.outputPerMillion;
            // The peak-pricing table only takes effect after the official rollout
            // date (2026-08-17 00:00 Beijing). Before that, the current single
            // prices remain authoritative even though the page already lists the
            // upcoming table.
            const peak = snapshot.peak?.[this.model];
            if (peak !== undefined && Date.now() >= PEAK_PRICING_START_MS) {
                const band = isPeakHour() ? peak.peak : peak.offPeak;
                cacheRead = band.cacheReadPerMillion;
                input = band.inputPerMillion;
                output = band.outputPerMillion;
            }
            return resolveCostConfig({
                inputPerMillion: input,
                cacheReadPerMillion: cacheRead,
                outputPerMillion: output,
                currency: this.costConfig.currency,
            });
        }
        return this.costConfig;
    }
    /**
     * Re-fetch the official pricing page and update the effective cost config.
     * Failures keep the previous snapshot (or the built-in preset) and record
     * the error so the client can surface it.
     */
    async refreshPricing() {
        this.pricingSnapshot = await fetchPricing();
    }
    /** Current pricing snapshot (for diagnostics / client display). */
    pricingInfo() {
        return this.pricingSnapshot;
    }
    async query() {
        const key = await this.resolveApiKey();
        const fetchedAt = Date.now();
        if (key === undefined) {
            return {
                fetchedAt,
                available: false,
                balances: [],
                error: `no API key (store ${this.apiKeyEnv} via the credentials seam, or export it in the environment)`,
            };
        }
        try {
            const { origin, prefix } = parseBaseUrl(this.baseUrl);
            const url = `${origin}${prefix}/user/balance`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15_000);
            let response;
            try {
                response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        authorization: `Bearer ${key}`,
                        accept: 'application/json',
                    },
                    signal: controller.signal,
                });
            }
            finally {
                clearTimeout(timer);
            }
            if (!response.ok) {
                const body = await response.text().catch(() => '');
                return {
                    fetchedAt,
                    available: false,
                    balances: [],
                    error: `Get User Balance failed: HTTP ${response.status}${body ? ` — ${truncate(body, 200)}` : ''}`,
                };
            }
            const payload = await response.json();
            const buckets = Array.isArray(payload.balance_infos)
                ? payload.balance_infos.map((b) => ({
                    currency: String(b.currency ?? ''),
                    total_balance: String(b.total_balance ?? '0'),
                    granted_balance: String(b.granted_balance ?? '0'),
                    topped_up_balance: String(b.topped_up_balance ?? '0'),
                })).filter((b) => b.currency !== '')
                : [];
            const total = buckets.length === 1
                ? Number(buckets[0].total_balance)
                : undefined;
            return {
                fetchedAt,
                available: payload.is_available !== false,
                balances: buckets,
                ...(total === undefined || Number.isNaN(total) ? {} : { total, currency: buckets[0].currency }),
            };
        }
        catch (error) {
            return {
                fetchedAt,
                available: false,
                balances: [],
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    /** Resolve the current API key through the credentials seam or the environment. */
    async resolveApiKey() {
        const credentials = this.ctx.get('credentials');
        if (credentials !== undefined) {
            const hit = await credentials.resolve(this.apiKeyEnv);
            if (hit !== undefined && hit.value.length > 0)
                return hit.value;
        }
        const ambient = this.ctx.get('launchEnvironment');
        const value = ambient?.get(String(this.apiKeyEnv));
        if (value !== undefined && value.value.length > 0)
            return value.value;
        const envFallback = process.env[String(this.apiKeyEnv)];
        if (typeof envFallback === 'string' && envFallback.length > 0)
            return envFallback;
        return undefined;
    }
}
/** Bound a provider error body for reporting. */
function truncate(text, max) {
    return text.length <= max ? text : `${text.slice(0, max)}..`;
}
