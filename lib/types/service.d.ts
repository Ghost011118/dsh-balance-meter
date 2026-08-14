/**
 * dsh-balance-meter host service — the `balance.*` RPC domain. Resolves the DeepSeek
 * API key through the DSH credentials seam (`ctx.credentials`, ref
 * `DEEPSEEK_API_KEY`) and queries the official Get User Balance endpoint,
 * caching the result so the browser readout can poll without spamming the
 * provider.
 * @module dsh-balance-meter/service
 */
import { Context, Service } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import { type CostConfig } from './cost.ts';
import { type PricingSnapshot } from './pricing.ts';
/** One currency bucket reported by Get User Balance. */
export interface BalanceInfo {
    /** ISO currency code (e.g. `CNY`). */
    currency: string;
    /** Total balance across granted and topped-up amounts. */
    total_balance: string;
    /** Grant (initial) balance, still present in this currency. */
    granted_balance: string;
    /** Topped-up (purchased) balance, still present in this currency. */
    topped_up_balance: string;
}
/** The full Get User Balance response body. */
export interface BalanceResponse {
    /** Whether the account can currently be billed. */
    is_available: boolean;
    /** Per-currency balance buckets. */
    balance_infos: BalanceInfo[];
}
/** Cleaned view served to the browser readout. */
export interface BalanceView {
    /** Query snapshot time (epoch ms). */
    fetchedAt: number;
    /** Whether the account can currently be billed. */
    available: boolean;
    /** Per-currency buckets. */
    balances: BalanceInfo[];
    /** The single summed total across all currencies (when exactly one currency). */
    total?: number;
    /** ISO currency of {@link total}. */
    currency?: string;
    /** Human-readable error when the provider query failed. */
    error?: string;
}
/** Plugin configuration. */
export interface BalanceConfig {
    /** Credential reference (env-style name) storing the DeepSeek API key. */
    apiKeyEnv?: string;
    /** DeepSeek API base URL (override for gateway/compat providers). */
    baseUrl?: string;
    /** Minimum seconds between provider queries (browser poll pacing). */
    refreshIntervalSeconds?: number;
    /**
     * Model pricing mode for the session cost estimate:
     * - `'auto'` (default): detect the model from each session's request header
     *   (`deepseek-v4-flash` → flash, `deepseek-v4-pro` → pro), falling back to
     *   flash when it cannot be resolved;
     * - `'flash'` / `'pro'`: force that preset, ignoring auto-detection.
     * Explicit {@link CostConfig} fields override the resolved preset.
     */
    model?: 'auto' | 'flash' | 'pro';
    /** Per-million-token prices for the session cost estimate. */
    cost?: CostConfig;
    /** Hours between automatic refreshes of the official pricing page. */
    pricingRefreshHours?: number;
    /** Master switch for the plugin (host routes + browser readout). */
    enabled?: boolean;
}
/** DeepSeek API base URL. */
export declare const DEFAULT_BASE_URL = "https://api.deepseek.com";
/** Default credential reference for the DeepSeek API key. */
export declare const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
/** Default provider query pacing. */
export declare const DEFAULT_REFRESH_INTERVAL_SECONDS = 30;
/** Default hours between automatic official-pricing refreshes. */
export declare const DEFAULT_PRICING_REFRESH_HOURS = 6;
/** Official peak-pricing rollout: 2026-08-17 00:00 Beijing time (UTC+8). */
export declare const PEAK_PRICING_START_MS: number;
/** One session's token usage and estimated cost. */
export interface SessionCost {
    /** Uncached input tokens. */
    uncachedInputTokens: number;
    /** Output tokens. */
    outputTokens: number;
    /** Cache-read tokens. */
    cacheReadTokens: number;
    /** Cache-write tokens. */
    cacheWriteTokens: number;
    /** Estimated total cost in the configured currency. */
    cost: number;
    /** Display currency of {@link cost}. */
    currency: string;
    /** Per-bucket cost breakdown. */
    breakdown: {
        input: number;
        cacheRead: number;
        cacheWrite: number;
        output: number;
    };
    /** Pricing preset used for this estimate: `flash`, `pro`, or the fallback configured model. */
    pricingKey: 'flash' | 'pro';
    /** The provider model id the estimate was based on; absent when only the fallback preset applied. */
    model?: string;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        balance: BalanceService;
    }
}
/**
 * DeepSeek Get User Balance client. Resolution of the API key re-reads the
 * credentials seam on every query so a changed key reaches the next query
 * without a plugin restart.
 */
export declare class BalanceService extends Service {
    private readonly apiKeyEnv;
    private readonly baseUrl;
    private readonly refreshIntervalMs;
    private readonly model;
    /** Explicit per-million price overrides from `config.cost`, applied on top of any model preset. */
    private readonly userCostOverrides;
    private pricingSnapshot;
    private pricingTimer;
    private cached;
    private cachedAt;
    private inflight;
    private enabled;
    constructor(ctx: Context, config?: BalanceConfig);
    /** Whether the balance service answers queries while enabled. */
    isEnabled(): boolean;
    /** Master switch: stop answering fresh provider queries (cache may still read). */
    setEnabled(enabled: boolean): void;
    /**
     * RPC: most recent balance + usage view. A healthy (error-free) cached view
     * is returned while still fresh; an erroneous view is never reused as fresh,
     * so the next poll re-queries the provider and the readout recovers
     * automatically once the underlying condition clears (without a manual
     * click). Concurrent queries are deduped.
     */
    view(): Promise<BalanceView>;
    /** RPC: force a fresh provider query (bypasses the cache window). */
    refresh(): Promise<BalanceView>;
    /**
     * RPC: current session token usage + estimated cost. Reads the official
     * `tokenUsage` projection (registered by dsh-token-meter) through the
     * session-projection registry and applies per-million prices for the model
     * actually driving this session (read from the session's request header),
     * falling back to the configured `model` preset when the live model cannot
     * be resolved. Returns zeroed values when the projection is unavailable.
     * @param session - the session whose usage is read.
     */
    sessionCost(session: Session): SessionCost;
    /**
     * Resolve the pricing preset (and the raw model id, when known) for this
     * session. An explicit configured `model` (`flash`/`pro`) wins over
     * auto-detection; otherwise (`auto`) the session's request header model id is
     * mapped to a preset, falling back to flash when no header exists or the id
     * is not a known DeepSeek family.
     * @param session - the session whose model to resolve.
     */
    private resolveModelForSession;
    /**
     * The cost config in effect right now for one pricing preset: auto-fetched
     * official prices when available (peak table applied by the current
     * Beijing-hour band once the peak rollout is live), otherwise the configured
     * preset for that model.
     * @param pricingKey - the model preset to price for (`flash` or `pro`).
     */
    private effectiveCostConfig;
    /** One preset field, with any explicit user override applied. */
    private applyOverride;
    /** The built-in preset prices for one model. */
    private modelCost;
    /**
     * Re-fetch the official pricing page and update the effective cost config.
     * Failures keep the previous snapshot (or the built-in preset) and record
     * the error so the client can surface it.
     */
    refreshPricing(): Promise<void>;
    /** Current pricing snapshot (for diagnostics / client display). */
    pricingInfo(): PricingSnapshot | undefined;
    private query;
    /** Resolve the current API key through the credentials seam or the environment. */
    private resolveApiKey;
}
//# sourceMappingURL=service.d.ts.map