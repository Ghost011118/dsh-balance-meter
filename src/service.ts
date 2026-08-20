/**
 * dsh-balance-meter host service — the `balance.*` RPC domain. Supports the
 * official DeepSeek balance endpoint, explicitly labelled proxy-compatible
 * endpoints, and a locally persisted manual balance ledger.
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

/** Provenance of the displayed balance. */
export type BalanceSource = 'official' | 'proxy' | 'manual'

/** Cumulative token counters used as a per-session manual-ledger checkpoint. */
export interface UsageCheckpoint {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Hidden, host-local state persisted through the DSH settings seam. */
export interface ManualLedger {
  version: 1
  initialBalance: number
  currency: string
  baselineAt: number
  remaining: number
  spent: number
  sessions: Record<string, UsageCheckpoint>
}

/** Cleaned view served to the browser readout. */
export interface BalanceView {
  /** Query snapshot time (epoch ms). */
  fetchedAt: number
  /** Whether the account can currently be billed. */
  available: boolean
  /** Per-currency buckets. */
  balances: BalanceInfo[]
  /** Explicit provenance; a proxy response is never labelled official. */
  source: BalanceSource
  /** The single summed total across all currencies (when exactly one currency). */
  total?: number
  /** ISO currency of {@link total}. */
  currency?: string
  /** Manual-mode starting balance (derived summary only; no ledger is exposed). */
  initialBalance?: number
  /** Manual-mode locally accumulated spend (derived summary only). */
  localSpent?: number
  /** Manual-mode baseline time. */
  baselineAt?: number
  /** Human-readable error when the provider query failed. */
  error?: string
}

/** Plugin configuration. */
export interface BalanceConfig {
  /** Balance source. Omitted custom base URLs are classified as `proxy`. */
  source?: BalanceSource
  /** Credential reference (env-style name) storing the DeepSeek API key. */
  apiKeyEnv?: string
  /** DeepSeek API base URL (override for gateway/compat providers). */
  baseUrl?: string
  /** Proxy endpoint path/URL; defaults to `/user/balance`. */
  balanceEndpoint?: string
  /** Dot path to a numeric balance in a non-DeepSeek proxy response. */
  proxyBalancePath?: string
  /** Currency for a numeric proxy balance. */
  proxyCurrency?: string
  /** User-entered current balance used to create/reset a local ledger. */
  manualBalance?: number
  /** Currency for {@link manualBalance}. */
  manualCurrency?: string
  /** Internal settings state; hidden from settings UIs and balance responses. */
  manualLedger?: ManualLedger
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
/** Default local/proxy display currency. */
export const DEFAULT_CURRENCY = 'CNY'

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
  if (raw.length > MAX_BASE_URL_LENGTH) {
    throw new Error(`dsh-balance-meter: baseUrl exceeds ${MAX_BASE_URL_LENGTH} characters`)
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`dsh-balance-meter: invalid baseUrl "${raw}"`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`dsh-balance-meter: baseUrl must be http(s), got "${url.protocol}"`)
  }
  const prefix = url.pathname.replace(/\/+$/, '')
  const origin = url.origin
  return { origin, prefix }
}

/** Whether a URL is the official DeepSeek API origin. */
function isOfficialBaseUrl(raw: string): boolean {
  try {
    return new URL(raw).origin === new URL(DEFAULT_BASE_URL).origin
  } catch {
    return false
  }
}

/** Preserve legacy custom `baseUrl` support while labelling it honestly. */
export function resolveBalanceSource(config: BalanceConfig): BalanceSource {
  if (config.source !== undefined) return config.source
  return isOfficialBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL) ? 'official' : 'proxy'
}

/** Cross-field validation shared by composition and the writable settings seam. */
export function validateBalanceConfig(config: BalanceConfig): void {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
  const source = resolveBalanceSource(config)
  parseBaseUrl(baseUrl)
  if (source === 'official' && !isOfficialBaseUrl(baseUrl)) {
    throw new Error('source "official" requires the https://api.deepseek.com origin; use source "proxy" for a relay')
  }
  if (config.manualBalance !== undefined && (!Number.isFinite(config.manualBalance) || config.manualBalance < 0)) {
    throw new Error('manualBalance must be a finite non-negative number')
  }
  const manualCurrency = normalizeCurrency(config.manualCurrency)
  normalizeCurrency(config.proxyCurrency)
  if (source === 'manual' && config.manualBalance === undefined) {
    throw new Error('source "manual" requires manualBalance')
  }
  const costCurrency = normalizeCurrency(config.cost?.currency)
  if (source === 'manual' && manualCurrency !== costCurrency) {
    throw new Error(`manualCurrency ${manualCurrency} must match the session-cost currency ${costCurrency}`)
  }
}

/** Validate and normalize a user-visible currency. */
function normalizeCurrency(value: string | undefined, fallback = DEFAULT_CURRENCY): string {
  const currency = (value ?? fallback).trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9_-]{0,11}$/.test(currency)) {
    throw new Error(`dsh-balance-meter: invalid currency "${value ?? ''}"`)
  }
  return currency
}

/** Resolve one own-property dot path without allowing prototype traversal. */
function valueAtPath(root: unknown, path: string): unknown {
  const segments = path.split('.').map(part => part.trim()).filter(Boolean)
  if (segments.length === 0 || segments.some(part => part === '__proto__' || part === 'prototype' || part === 'constructor')) {
    throw new Error(`proxyBalancePath "${path}" is invalid`)
  }
  let value = root
  for (const segment of segments) {
    if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, segment)) {
      throw new Error(`proxy balance path "${path}" was not found`)
    }
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

/** Parse an official or explicitly proxy-labelled balance response. */
export function parseProviderBalance(
  payload: unknown,
  source: Exclude<BalanceSource, 'manual'>,
  options: { balancePath?: string; currency?: string; fetchedAt?: number } = {},
): BalanceView {
  const fetchedAt = options.fetchedAt ?? Date.now()
  const record = payload !== null && typeof payload === 'object'
    ? payload as Partial<BalanceResponse> & Record<string, unknown>
    : undefined
  if (record !== undefined && Array.isArray(record.balance_infos)) {
    const buckets: BalanceInfo[] = record.balance_infos.map((value) => {
      const bucket = value as Partial<BalanceInfo>
      return {
        currency: String(bucket.currency ?? ''),
        total_balance: String(bucket.total_balance ?? '0'),
        granted_balance: String(bucket.granted_balance ?? '0'),
        topped_up_balance: String(bucket.topped_up_balance ?? '0'),
      }
    }).filter(bucket => bucket.currency !== '')
    if (source === 'proxy' && buckets.length === 0) {
      throw new Error('proxy balance response contained no usable balance_infos')
    }
    const total = buckets.length === 1 ? Number(buckets[0]!.total_balance) : undefined
    if (total !== undefined && !Number.isFinite(total)) {
      throw new Error(`${source} balance response contained a non-numeric total_balance`)
    }
    return {
      fetchedAt,
      source,
      available: record.is_available !== false,
      balances: buckets,
      ...(total === undefined ? {} : { total, currency: buckets[0]!.currency }),
    }
  }
  if (source === 'official') {
    throw new Error('official balance response did not match the DeepSeek balance_infos schema')
  }
  if (options.balancePath === undefined || options.balancePath.trim() === '') {
    throw new Error('proxy balance response schema is unknown; configure proxyBalancePath')
  }
  const raw = valueAtPath(payload, options.balancePath)
  if ((typeof raw !== 'number' && typeof raw !== 'string') || (typeof raw === 'string' && raw.trim() === '')) {
    throw new Error(`proxy balance path "${options.balancePath}" is not numeric`)
  }
  const total = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(total)) {
    throw new Error(`proxy balance path "${options.balancePath}" is not numeric`)
  }
  return {
    fetchedAt,
    source: 'proxy',
    available: total > 0,
    balances: [],
    total,
    currency: normalizeCurrency(options.currency),
  }
}

/** Create a local ledger whose existing sessions are already checkpointed. */
export function createManualLedger(
  initialBalance: number,
  currency: string,
  baselineAt: number,
  sessions: Record<string, UsageCheckpoint> = {},
): ManualLedger {
  if (!Number.isFinite(initialBalance) || initialBalance < 0) {
    throw new Error('manualBalance must be a finite non-negative number')
  }
  return {
    version: 1,
    initialBalance,
    currency: normalizeCurrency(currency),
    baselineAt,
    remaining: initialBalance,
    spent: 0,
    sessions,
  }
}

/** Advance one session exactly once by charging only positive token deltas. */
export function advanceManualLedger(
  ledger: ManualLedger,
  sessionId: string,
  sessionCreatedAt: number,
  usage: UsageCheckpoint,
  cost: ReturnType<typeof resolveCostConfig>,
): ManualLedger {
  const previous = ledger.sessions[sessionId]
  // Token projections can be temporarily absent while a restored session is
  // still attaching. Never move a durable checkpoint backwards: otherwise a
  // later projection recovery would charge the same cumulative tokens again.
  const checkpoint: UsageCheckpoint = previous === undefined
    ? { ...usage }
    : {
        uncachedInputTokens: Math.max(previous.uncachedInputTokens, usage.uncachedInputTokens),
        outputTokens: Math.max(previous.outputTokens, usage.outputTokens),
        cacheReadTokens: Math.max(previous.cacheReadTokens, usage.cacheReadTokens),
        cacheWriteTokens: Math.max(previous.cacheWriteTokens, usage.cacheWriteTokens),
      }
  if (previous === undefined && sessionCreatedAt <= ledger.baselineAt) {
    return { ...ledger, sessions: { ...ledger.sessions, [sessionId]: checkpoint } }
  }
  const before = previous ?? { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const delta = {
    inputTokens: checkpoint.uncachedInputTokens - before.uncachedInputTokens,
    outputTokens: checkpoint.outputTokens - before.outputTokens,
    cacheReadTokens: checkpoint.cacheReadTokens - before.cacheReadTokens,
    cacheWriteTokens: checkpoint.cacheWriteTokens - before.cacheWriteTokens,
  }
  const charged = costOfUsage(delta, cost)
  if (previous !== undefined
    && charged === 0
    && previous.uncachedInputTokens === checkpoint.uncachedInputTokens
    && previous.outputTokens === checkpoint.outputTokens
    && previous.cacheReadTokens === checkpoint.cacheReadTokens
    && previous.cacheWriteTokens === checkpoint.cacheWriteTokens) {
    return ledger
  }
  return {
    ...ledger,
    remaining: ledger.remaining - charged,
    spent: ledger.spent + charged,
    sessions: { ...ledger.sessions, [sessionId]: checkpoint },
  }
}

/** Project a ledger into the browser-safe summary (never includes checkpoints). */
export function manualLedgerView(ledger: ManualLedger, fetchedAt = Date.now()): BalanceView {
  return {
    fetchedAt,
    source: 'manual',
    available: ledger.remaining > 0,
    balances: [],
    total: ledger.remaining,
    currency: ledger.currency,
    initialBalance: ledger.initialBalance,
    localSpent: ledger.spent,
    baselineAt: ledger.baselineAt,
  }
}

/**
 * DeepSeek Get User Balance client. Resolution of the API key re-reads the
 * credentials seam on every query so a changed key reaches the next query
 * without a plugin restart.
 */
export class BalanceService extends Service {
  private apiKeyEnv: CredentialRef
  private baseUrl: string
  private source: BalanceSource
  private balanceEndpoint: string | undefined
  private proxyBalancePath: string | undefined
  private proxyCurrency: string
  private manualBalance: number | undefined
  private manualCurrency: string
  private manualLedger: ManualLedger | undefined
  private persistManualLedger: ((ledger: ManualLedger) => Promise<void>) | undefined
  private manualQueue: Promise<void> = Promise.resolve()
  private refreshIntervalMs: number
  private model: 'auto' | 'flash' | 'pro'
  /** Explicit per-million price overrides from `config.cost`, applied on top of any model preset. */
  private userCostOverrides: CostConfig | undefined
  private pricingSnapshot: PricingSnapshot | undefined
  private pricingTimer: NodeJS.Timeout | undefined
  private cached: BalanceView | undefined
  private cachedAt = 0
  private inflight: Promise<BalanceView> | undefined
  private enabled: boolean

  constructor(ctx: Context, config: BalanceConfig = {}) {
    super(ctx, 'balance')
    this.apiKeyEnv = credentialRef(DEFAULT_API_KEY_ENV)
    this.baseUrl = DEFAULT_BASE_URL
    this.source = 'official'
    this.proxyCurrency = DEFAULT_CURRENCY
    this.manualCurrency = DEFAULT_CURRENCY
    this.refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_SECONDS * 1_000
    this.model = 'auto'
    this.enabled = true
    this.configure(config)
    // Refresh pricing once at boot, then on a slow cadence (6h) so a price
    // change or the peak-pricing rollout is picked up without a restart.
    void this.refreshPricing()
    const cadenceMs = (config.pricingRefreshHours ?? DEFAULT_PRICING_REFRESH_HOURS) * 3_600_000
    this.pricingTimer = setInterval(() => { void this.refreshPricing() }, cadenceMs)
    this.pricingTimer.unref?.()
  }

  /** Apply the current resolved settings snapshot to every live-query field. */
  configure(config: BalanceConfig): void {
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
    const source = resolveBalanceSource(config)
    validateBalanceConfig(config)
    const manualCurrency = normalizeCurrency(config.manualCurrency)
    const proxyCurrency = normalizeCurrency(config.proxyCurrency)
    const manualInputChanged = this.manualBalance !== config.manualBalance || this.manualCurrency !== manualCurrency
    this.apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
    this.baseUrl = baseUrl
    this.source = source
    this.balanceEndpoint = config.balanceEndpoint
    this.proxyBalancePath = config.proxyBalancePath
    this.proxyCurrency = proxyCurrency
    this.manualBalance = config.manualBalance
    this.manualCurrency = manualCurrency
    this.refreshIntervalMs = Math.max(0, (config.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS) * 1_000)
    this.model = config.model ?? 'auto'
    this.userCostOverrides = config.cost
    this.enabled = config.enabled ?? true
    const candidate = config.manualLedger
    const matchesInput = candidate?.version === 1
      && candidate.initialBalance === this.manualBalance
      && candidate.currency === this.manualCurrency
    if (matchesInput) this.manualLedger = candidate
    else if (manualInputChanged || candidate !== undefined) this.manualLedger = undefined
    this.cached = undefined
    this.cachedAt = 0
  }

  /** Attach the only authorized persistence path: the DSH settings namespace. */
  setManualLedgerPersistence(persist: (ledger: ManualLedger) => Promise<void>): void {
    this.persistManualLedger = persist
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
  async view(session?: Session): Promise<BalanceView> {
    if (!this.enabled) return { fetchedAt: Date.now(), source: this.source, available: false, balances: [], error: 'disabled' }
    if (this.source === 'manual') return this.manualView(session)
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
  async refresh(session?: Session): Promise<BalanceView> {
    if (this.source === 'manual') return this.manualView(session)
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
    const buckets = this.sessionUsage(session)
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

  /** Checkpoint a restored pre-baseline session before it can accrue live usage. */
  async checkpointSession(session: Session): Promise<void> {
    if (this.source !== 'manual') return
    await this.withManualLock(async () => {
      const ledger = await this.ensureManualLedger()
      const id = String(session.id)
      if (ledger.sessions[id] !== undefined || session.header.createdAt > ledger.baselineAt) return
      await this.commitManualLedger({
        ...ledger,
        sessions: { ...ledger.sessions, [id]: this.sessionUsage(session) },
      })
    })
  }

  /** Read DSH's durable cumulative token projection. */
  private sessionUsage(session: Session): UsageCheckpoint {
    const registry = this.ctx.get('sessionProjections') as
      | { snapshot(s: Session): { values: Partial<Record<string, unknown>> } }
      | undefined
    let usage: TokenUsageProjection | undefined
    if (registry !== undefined) {
      const value = registry.snapshot(session).values.tokenUsage
      if (value !== null && typeof value === 'object') usage = value as TokenUsageProjection
    }
    const tokenCount = (value: unknown): number => {
      const count = Number(value ?? 0)
      return Number.isFinite(count) && count >= 0 ? count : 0
    }
    return {
      uncachedInputTokens: tokenCount(usage?.uncachedInputTokens),
      outputTokens: tokenCount(usage?.outputTokens),
      cacheReadTokens: tokenCount(usage?.cacheReadTokens),
      cacheWriteTokens: tokenCount(usage?.cacheWriteTokens),
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

  /** Serialize manual ledger reads/writes so concurrent browser polls cannot double-charge. */
  private withManualLock<T>(run: () => Promise<T>): Promise<T> {
    const result = this.manualQueue.then(run, run)
    this.manualQueue = result.then(() => undefined, () => undefined)
    return result
  }

  /** Initialize a new baseline and checkpoint all currently live sessions. */
  private async ensureManualLedger(): Promise<ManualLedger> {
    if (this.manualBalance === undefined) {
      throw new Error('manual mode requires manualBalance in DSH settings')
    }
    const current = this.manualLedger
    if (current !== undefined
      && current.version === 1
      && current.initialBalance === this.manualBalance
      && current.currency === this.manualCurrency) {
      return current
    }
    const sessionsStore = this.ctx.get('sessions') as { list(): Session[] } | undefined
    const checkpoints: Record<string, UsageCheckpoint> = {}
    for (const session of sessionsStore?.list() ?? []) {
      checkpoints[String(session.id)] = this.sessionUsage(session)
    }
    const ledger = createManualLedger(this.manualBalance, this.manualCurrency, Date.now(), checkpoints)
    await this.commitManualLedger(ledger)
    return ledger
  }

  /** Persist before publishing in memory; failure leaves the previous ledger intact. */
  private async commitManualLedger(ledger: ManualLedger): Promise<void> {
    const persist = this.persistManualLedger
    if (persist === undefined) {
      throw new Error('manual mode requires a writable DSH settings provider')
    }
    await persist(ledger)
    this.manualLedger = ledger
    this.cached = undefined
  }

  /** Local remaining balance, optionally advanced for one current session. */
  private async manualView(session?: Session): Promise<BalanceView> {
    try {
      return await this.withManualLock(async () => {
        let ledger = await this.ensureManualLedger()
        if (session !== undefined) {
          const { pricingKey } = this.resolveModelForSession(session)
          const next = advanceManualLedger(
            ledger,
            String(session.id),
            session.header.createdAt,
            this.sessionUsage(session),
            this.effectiveCostConfig(pricingKey),
          )
          if (next !== ledger) {
            await this.commitManualLedger(next)
            ledger = next
          }
        }
        return manualLedgerView(ledger)
      })
    } catch (error) {
      return {
        fetchedAt: Date.now(),
        source: 'manual',
        available: false,
        balances: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** Build the configured balance endpoint without leaking the credential. */
  private balanceUrl(): string {
    if (this.source === 'official') return `${DEFAULT_BASE_URL}/user/balance`
    const endpoint = this.balanceEndpoint?.trim()
    if (endpoint !== undefined && endpoint !== '') {
      if (/^https?:\/\//i.test(endpoint)) return parseBaseUrl(endpoint).origin + parseBaseUrl(endpoint).prefix
      const { origin, prefix } = parseBaseUrl(this.baseUrl)
      return `${origin}${prefix}/${endpoint.replace(/^\/+/, '')}`
    }
    const { origin, prefix } = parseBaseUrl(this.baseUrl)
    return `${origin}${prefix}/user/balance`
  }

  private async query(): Promise<BalanceView> {
    const source = this.source === 'manual' ? 'proxy' : this.source
    const key = await this.resolveApiKey()
    const fetchedAt = Date.now()
    if (key === undefined) {
      return {
        fetchedAt,
        source,
        available: false,
        balances: [],
        error: `no API key (store ${this.apiKeyEnv} via the credentials seam, or export it in the environment)`,
      }
    }
    try {
      const url = this.balanceUrl()
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
        return {
          fetchedAt,
          source,
          available: false,
          balances: [],
          error: `${source} balance request failed: HTTP ${response.status}`,
        }
      }
      const payload = await response.json() as unknown
      return parseProviderBalance(payload, source, {
        balancePath: this.proxyBalancePath,
        currency: this.proxyCurrency,
        fetchedAt,
      })
    } catch (error) {
      return {
        fetchedAt,
        source,
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
