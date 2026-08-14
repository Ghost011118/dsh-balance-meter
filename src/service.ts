/**
 * dsh-balance-meter host service — the `balance.*` RPC domain. Resolves the DeepSeek
 * API key through the DSH credentials seam (`ctx.credentials`, ref
 * `DEEPSEEK_API_KEY`) and queries the official Get User Balance endpoint,
 * caching the result so the browser readout can poll without spamming the
 * provider.
 * @module dsh-balance-meter/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { Session } from '@deepseek-ai/dsh-session'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter'
import {
  resolveCostConfig,
  costOfUsage,
  costOfTokens,
  FLASH_COST_CONFIG,
  PRO_COST_CONFIG,
  type CostConfig,
} from './cost.ts'
import { fetchPricing, isPeakHour, type PricingSnapshot } from './pricing.ts'

/** One currency bucket reported by Get User Balance. */
export interface BalanceInfo {
  /** ISO currency code (e.g. `CNY`). */
  currency: string
  /** Total balance across granted and topped-up amounts. */
  total_balance: string
  /** Grant (initial) balance, still present in this currency. */
  granted_balance: string
  /** Topped-up (purchased) balance, still present in this currency. */
  topped_up_balance: string
}

/** The full Get User Balance response body. */
export interface BalanceResponse {
  /** Whether the account can currently be billed. */
  is_available: boolean
  /** Per-currency balance buckets. */
  balance_infos: BalanceInfo[]
}

/** Cleaned view served to the browser readout. */
export interface BalanceView {
  /** Query snapshot time (epoch ms). */
  fetchedAt: number
  /** Whether the account can currently be billed. */
  available: boolean
  /** Per-currency buckets. */
  balances: BalanceInfo[]
  /** The single summed total across all currencies (when exactly one currency). */
  total?: number
  /** ISO currency of {@link total}. */
  currency?: string
  /** Human-readable error when the provider query failed. */
  error?: string
}

/** Plugin configuration. */
export interface BalanceConfig {
  /** Credential reference (env-style name) storing the DeepSeek API key. */
  apiKeyEnv?: string
  /** DeepSeek API base URL (override for gateway/compat providers). */
  baseUrl?: string
  /** Minimum seconds between provider queries (browser poll pacing). */
  refreshIntervalSeconds?: number
  /**
   * Model pricing mode for the session cost estimate:
   * - `'auto'` (default): detect the model from each session's request header
   *   (`deepseek-v4-flash` → flash, `deepseek-v4-pro` → pro), falling back to
   *   flash when it cannot be resolved;
   * - `'flash'` / `'pro'`: force that preset, ignoring auto-detection.
   * Explicit {@link CostConfig} fields override the resolved preset.
   */
  model?: 'auto' | 'flash' | 'pro'
  /** Per-million-token prices for the session cost estimate. */
  cost?: CostConfig
  /** Hours between automatic refreshes of the official pricing page. */
  pricingRefreshHours?: number
  /** Master switch for the plugin (host routes + browser readout). */
  enabled?: boolean
}

/** DeepSeek API base URL. */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'
/** Default credential reference for the DeepSeek API key. */
export const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
/** Default provider query pacing. */
export const DEFAULT_REFRESH_INTERVAL_SECONDS = 30
/** Default hours between automatic official-pricing refreshes. */
export const DEFAULT_PRICING_REFRESH_HOURS = 6
/** Official peak-pricing rollout: 2026-08-17 00:00 Beijing time (UTC+8). */
export const PEAK_PRICING_START_MS = Date.UTC(2026, 7, 16, 16, 0, 0)
/** SSRF / length guard for the base URL. */
const MAX_BASE_URL_LENGTH = 256

/** One session's token usage and estimated cost. */
export interface SessionCost {
  /** Uncached input tokens. */
  uncachedInputTokens: number
  /** Output tokens. */
  outputTokens: number
  /** Cache-read tokens. */
  cacheReadTokens: number
  /** Cache-write tokens. */
  cacheWriteTokens: number
  /** Estimated total cost in the configured currency. */
  cost: number
  /** Display currency of {@link cost}. */
  currency: string
  /** Per-bucket cost breakdown. */
  breakdown: { input: number; cacheRead: number; cacheWrite: number; output: number }
  /** Pricing preset used for this estimate: `flash`, `pro`, or the fallback configured model. */
  pricingKey: 'flash' | 'pro'
  /** The provider model id the estimate was based on; absent when only the fallback preset applied. */
  model?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    balance: BalanceService
  }
}

/** Parse a base URL into a safe `{ origin, pathPrefix }` pair. */
function parseBaseUrl(raw: string): { origin: string; prefix: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`dsh-balance-meter: invalid baseUrl "${raw}"`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`dsh-balance-meter: baseUrl must be http(s), got "${url.protocol}"`)
  }
  let prefix = url.pathname.replace(/\/+$/, '')
  let origin = url.origin
  return { origin, prefix }
}

/**
 * DeepSeek Get User Balance client. Resolution of the API key re-reads the
 * credentials seam on every query so a changed key reaches the next query
 * without a plugin restart.
 */
export class BalanceService extends Service {
  private readonly apiKeyEnv: CredentialRef
  private readonly baseUrl: string
  private readonly refreshIntervalMs: number
  private readonly model: 'auto' | 'flash' | 'pro'
  /** Explicit per-million price overrides from `config.cost`, applied on top of any model preset. */
  private readonly userCostOverrides: CostConfig | undefined
  private pricingSnapshot: PricingSnapshot | undefined
  private pricingTimer: NodeJS.Timeout | undefined
  private cached: BalanceView | undefined
  private cachedAt = 0
  private inflight: Promise<BalanceView> | undefined
  private enabled: boolean

  constructor(ctx: Context, config: BalanceConfig = {}) {
    super(ctx, 'balance')
    this.apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
    this.refreshIntervalMs = Math.max(0, (config.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS) * 1_000)
    this.model = config.model ?? 'auto'
    this.userCostOverrides = config.cost
    this.enabled = config.enabled ?? true
    // Refresh pricing once at boot, then on a slow cadence (6h) so a price
    // change or the peak-pricing rollout is picked up without a restart.
    void this.refreshPricing()
    const cadenceMs = (config.pricingRefreshHours ?? DEFAULT_PRICING_REFRESH_HOURS) * 3_600_000
    this.pricingTimer = setInterval(() => { void this.refreshPricing() }, cadenceMs)
    this.pricingTimer.unref?.()
  }

  /** Whether the balance service answers queries while enabled. */
  isEnabled(): boolean {
    return this.enabled
  }

  /** Master switch: stop answering fresh provider queries (cache may still read). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  /**
   * RPC: most recent balance + usage view. A healthy (error-free) cached view
   * is returned while still fresh; an erroneous view is never reused as fresh,
   * so the next poll re-queries the provider and the readout recovers
   * automatically once the underlying condition clears (without a manual
   * click). Concurrent queries are deduped.
   */
  async view(): Promise<BalanceView> {
    if (!this.enabled) return { fetchedAt: Date.now(), available: false, balances: [], error: 'disabled' }
    const now = Date.now()
    const cached = this.cached
    if (cached !== undefined && cached.error === undefined && now - this.cachedAt < this.refreshIntervalMs && this.refreshIntervalMs > 0) {
      return cached
    }
    if (this.inflight !== undefined) return this.inflight
    this.inflight = this.query().then((view) => {
      this.cached = view
      this.cachedAt = Date.now()
      return view
    }).finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }

  /** RPC: force a fresh provider query (bypasses the cache window). */
  async refresh(): Promise<BalanceView> {
    const view = await this.query()
    this.cached = view
    this.cachedAt = Date.now()
    return view
  }

  /**
   * RPC: current session token usage + estimated cost. Reads the official
   * `tokenUsage` projection (registered by dsh-token-meter) through the
   * session-projection registry and applies per-million prices for the model
   * actually driving this session (read from the session's request header),
   * falling back to the configured `model` preset when the live model cannot
   * be resolved. Returns zeroed values when the projection is unavailable.
   * @param session - the session whose usage is read.
   */
  sessionCost(session: Session): SessionCost {
    const registry = this.ctx.get('sessionProjections') as
      | { snapshot(s: Session): { values: Partial<Record<string, unknown>> } }
      | undefined
    let usage: TokenUsageProjection | undefined
    if (registry !== undefined) {
      const value = registry.snapshot(session).values.tokenUsage
      if (value !== null && typeof value === 'object') usage = value as TokenUsageProjection
    }
    const zero = {
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    const buckets = usage ?? zero
    const { model, pricingKey } = this.resolveModelForSession(session)
    const config = this.effectiveCostConfig(pricingKey)
    const cost = costOfUsage({
      inputTokens: buckets.uncachedInputTokens,
      outputTokens: buckets.outputTokens,
      cacheReadTokens: buckets.cacheReadTokens,
      cacheWriteTokens: buckets.cacheWriteTokens,
    }, config)
    return {
      ...buckets,
      cost,
      currency: config.currency,
      pricingKey,
      ...(model === undefined ? {} : { model }),
      breakdown: {
        input: costOfTokens(buckets.uncachedInputTokens, config.inputPerMillion),
        cacheRead: costOfTokens(buckets.cacheReadTokens, config.cacheReadPerMillion),
        cacheWrite: costOfTokens(buckets.cacheWriteTokens, config.cacheWritePerMillion),
        output: costOfTokens(buckets.outputTokens, config.outputPerMillion),
      },
    }
  }

  /**
   * Resolve the pricing preset (and the raw model id, when known) for this
   * session. An explicit configured `model` (`flash`/`pro`) wins over
   * auto-detection; otherwise (`auto`) the session's request header model id is
   * mapped to a preset, falling back to flash when no header exists or the id
   * is not a known DeepSeek family.
   * @param session - the session whose model to resolve.
   */
  private resolveModelForSession(session: Session): { model?: string; pricingKey: 'flash' | 'pro' } {
    if (this.model !== 'auto') return { pricingKey: this.model }
    const header = typeof session.requestHeader === 'function' ? session.requestHeader() : undefined
    const modelId = header?.config?.model
    if (typeof modelId === 'string' && modelId.length > 0) {
      const lower = modelId.toLowerCase()
      if (lower.includes('pro')) return { model: modelId, pricingKey: 'pro' }
      if (lower.includes('flash')) return { model: modelId, pricingKey: 'flash' }
    }
    return { pricingKey: 'flash' }
  }

  /**
   * The cost config in effect right now for one pricing preset: auto-fetched
   * official prices when available (peak table applied by the current
   * Beijing-hour band once the peak rollout is live), otherwise the configured
   * preset for that model.
   * @param pricingKey - the model preset to price for (`flash` or `pro`).
   */
  private effectiveCostConfig(pricingKey: 'flash' | 'pro' = 'flash'): ReturnType<typeof resolveCostConfig> {
    const snapshot = this.pricingSnapshot
    if (snapshot !== undefined && snapshot.error === undefined) {
      const prices = snapshot.current[pricingKey]
      let cacheRead = prices.cacheReadPerMillion
      let input = prices.inputPerMillion
      let output = prices.outputPerMillion
      // The peak-pricing table only takes effect after the official rollout
      // date (2026-08-17 00:00 Beijing). Before that, the current single
      // prices remain authoritative even though the page already lists the
      // upcoming table.
      const peak = snapshot.peak?.[pricingKey]
      if (peak !== undefined && Date.now() >= PEAK_PRICING_START_MS) {
        const band = isPeakHour() ? peak.peak : peak.offPeak
        cacheRead = band.cacheReadPerMillion
        input = band.inputPerMillion
        output = band.outputPerMillion
      }
      return resolveCostConfig({
        inputPerMillion: input,
        cacheReadPerMillion: cacheRead,
        outputPerMillion: output,
        currency: this.userCostOverrides?.currency ?? this.modelCost(pricingKey).currency,
      })
    }
    return resolveCostConfig({
      inputPerMillion: this.applyOverride(pricingKey, 'inputPerMillion'),
      cacheReadPerMillion: this.applyOverride(pricingKey, 'cacheReadPerMillion'),
      cacheWritePerMillion: pricingKey === 'pro' ? PRO_COST_CONFIG.cacheWritePerMillion : FLASH_COST_CONFIG.cacheWritePerMillion,
      outputPerMillion: this.applyOverride(pricingKey, 'outputPerMillion'),
      currency: this.userCostOverrides?.currency ?? this.modelCost(pricingKey).currency,
    })
  }

  /** One preset field, with any explicit user override applied. */
  private applyOverride(
    pricingKey: 'flash' | 'pro',
    field: 'inputPerMillion' | 'cacheReadPerMillion' | 'outputPerMillion',
  ): number {
    const override = this.userCostOverrides?.[field]
    if (typeof override === 'number') return override
    return this.modelCost(pricingKey)[field]
  }

  /** The built-in preset prices for one model. */
  private modelCost(pricingKey: 'flash' | 'pro'): Required<CostConfig> {
    return pricingKey === 'pro' ? PRO_COST_CONFIG : FLASH_COST_CONFIG
  }

  /**
   * Re-fetch the official pricing page and update the effective cost config.
   * Failures keep the previous snapshot (or the built-in preset) and record
   * the error so the client can surface it.
   */
  async refreshPricing(): Promise<void> {
    this.pricingSnapshot = await fetchPricing()
  }

  /** Current pricing snapshot (for diagnostics / client display). */
  pricingInfo(): PricingSnapshot | undefined {
    return this.pricingSnapshot
  }

  private async query(): Promise<BalanceView> {
    const key = await this.resolveApiKey()
    const fetchedAt = Date.now()
    if (key === undefined) {
      return {
        fetchedAt,
        available: false,
        balances: [],
        error: `no API key (store ${this.apiKeyEnv} via the credentials seam, or export it in the environment)`,
      }
    }
    try {
      const { origin, prefix } = parseBaseUrl(this.baseUrl)
      const url = `${origin}${prefix}/user/balance`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      let response: Response
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: {
            authorization: `Bearer ${key}`,
            accept: 'application/json',
          },
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        return {
          fetchedAt,
          available: false,
          balances: [],
          error: `Get User Balance failed: HTTP ${response.status}${body ? ` — ${truncate(body, 200)}` : ''}`,
        }
      }
      const payload = await response.json() as Partial<BalanceResponse>
      const buckets: BalanceInfo[] = Array.isArray(payload.balance_infos)
        ? payload.balance_infos.map((b) => ({
          currency: String(b.currency ?? ''),
          total_balance: String(b.total_balance ?? '0'),
          granted_balance: String(b.granted_balance ?? '0'),
          topped_up_balance: String(b.topped_up_balance ?? '0'),
        })).filter((b) => b.currency !== '')
        : []
      const total = buckets.length === 1
        ? Number(buckets[0]!.total_balance)
        : undefined
      return {
        fetchedAt,
        available: payload.is_available !== false,
        balances: buckets,
        ...(total === undefined || Number.isNaN(total) ? {} : { total, currency: buckets[0]!.currency }),
      }
    } catch (error) {
      return {
        fetchedAt,
        available: false,
        balances: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** Resolve the current API key through the credentials seam or the environment. */
  private async resolveApiKey(): Promise<string | undefined> {
    const credentials = this.ctx.get('credentials') as { resolve(ref: CredentialRef): Promise<{ value: string } | undefined> } | undefined
    if (credentials !== undefined) {
      const hit = await credentials.resolve(this.apiKeyEnv)
      if (hit !== undefined && hit.value.length > 0) return hit.value
    }
    const ambient = this.ctx.get('launchEnvironment') as
      | { get(name: string): { value: string } | undefined }
      | undefined
    const value = ambient?.get(String(this.apiKeyEnv))
    if (value !== undefined && value.value.length > 0) return value.value
    const envFallback = (process.env as Record<string, string | undefined>)[String(this.apiKeyEnv)]
    if (typeof envFallback === 'string' && envFallback.length > 0) return envFallback
    return undefined
  }
}

/** Bound a provider error body for reporting. */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}..`
}
