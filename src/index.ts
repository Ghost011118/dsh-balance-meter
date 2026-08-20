/**
 * dsh-balance-meter host half — mounts the balance service and its HTTP routes.
 * The browser half (the `./client` entry) reads the DeepSeek account balance
 * and the current session's estimated cost through the same-origin
 * `/api/balance` JSON endpoints. Install via
 * `dsh plugin --profile web add link:<dsh-web-ui>/packages/dsh-balance-meter`; the
 * cordis.patch.yml inserts this plugin row.
 * @module dsh-balance-meter
 */

import { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import {
  BalanceService,
  DEFAULT_API_KEY_ENV,
  DEFAULT_BASE_URL,
  DEFAULT_CURRENCY,
  DEFAULT_REFRESH_INTERVAL_SECONDS,
  validateBalanceConfig,
  type BalanceConfig,
  type ManualLedger,
} from './service.ts'
import { BALANCE_API_PREFIX, makeBalanceRoutes } from './routes.ts'

export { BalanceService } from './service.ts'
export type {
  BalanceConfig,
  BalanceInfo,
  BalanceResponse,
  BalanceSource,
  BalanceView,
  ManualLedger,
  SessionCost,
  UsageCheckpoint,
} from './service.ts'
export { BALANCE_API_PREFIX, makeBalanceRoutes } from './routes.ts'
export {
  DEFAULT_API_KEY_ENV,
  DEFAULT_BASE_URL,
  DEFAULT_CURRENCY,
  DEFAULT_REFRESH_INTERVAL_SECONDS,
} from './service.ts'
export {
  advanceManualLedger,
  createManualLedger,
  manualLedgerView,
  parseProviderBalance,
  resolveBalanceSource,
  validateBalanceConfig,
} from './service.ts'
export { resolveCostConfig, costOfUsage, costOfTokens, DEFAULT_COST_CONFIG, FLASH_COST_CONFIG, PRO_COST_CONFIG } from './cost.ts'
export type { CostBreakdown, CostConfig } from './cost.ts'
export { fetchPricing, isPeakHour, PRICING_URL } from './pricing.ts'
export type { ParsedPrices, PricingSnapshot } from './pricing.ts'

/** Settings namespace of the balance capability. */
export const BALANCE_SETTINGS_NAMESPACE = 'balance'

/** Settings section schema: what the web settings surface edits. */
const USAGE_CHECKPOINT_SCHEMA = z.object({
  uncachedInputTokens: z.number().min(0),
  outputTokens: z.number().min(0),
  cacheReadTokens: z.number().min(0),
  cacheWriteTokens: z.number().min(0),
})

const MANUAL_LEDGER_SCHEMA = z.object({
  version: z.const(1),
  initialBalance: z.number().min(0),
  currency: z.string(),
  baselineAt: z.number().min(0),
  remaining: z.number(),
  spent: z.number().min(0),
  sessions: z.dict(USAGE_CHECKPOINT_SCHEMA),
}).role('secret').hidden()

export const BALANCE_SETTINGS_SCHEMA: z<any> = z.object({
  source: z.union(['official', 'proxy', 'manual']),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  balanceEndpoint: z.string(),
  proxyBalancePath: z.string(),
  proxyCurrency: z.string().default(DEFAULT_CURRENCY),
  manualBalance: z.number().min(0),
  manualCurrency: z.string().default(DEFAULT_CURRENCY),
  manualLedger: MANUAL_LEDGER_SCHEMA,
  refreshIntervalSeconds: z.number().min(0).max(3600).default(DEFAULT_REFRESH_INTERVAL_SECONDS),
  enabled: z.boolean().default(true),
})

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'balance'

/** Services required before the balance service can answer. */
export const inject = ['webServer', 'sessions']

/** Register the balance service and its API routes on the context. */
export function apply(ctx: Context, config: BalanceConfig = {}): void {
  const service = new BalanceService(ctx, config)
  const namespace = settingsNamespace(BALANCE_SETTINGS_NAMESPACE)

  const base: BalanceConfig = {
    ...(config.source === undefined ? {} : { source: config.source }),
    apiKeyEnv: config.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    ...(config.balanceEndpoint === undefined ? {} : { balanceEndpoint: config.balanceEndpoint }),
    ...(config.proxyBalancePath === undefined ? {} : { proxyBalancePath: config.proxyBalancePath }),
    proxyCurrency: config.proxyCurrency ?? DEFAULT_CURRENCY,
    ...(config.manualBalance === undefined ? {} : { manualBalance: config.manualBalance }),
    manualCurrency: config.manualCurrency ?? DEFAULT_CURRENCY,
    ...(config.manualLedger === undefined ? {} : { manualLedger: config.manualLedger }),
    refreshIntervalSeconds: config.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS,
    ...(config.model === undefined ? {} : { model: config.model }),
    ...(config.cost === undefined ? {} : { cost: config.cost }),
    enabled: config.enabled ?? true,
  }
  // The settings surface edits schema-declared fields; model/cost remain
  // composition-only and are re-applied beneath the resolved user section.
  let current: () => BalanceConfig = () => base

  const applyConfig = (section: BalanceConfig): void => {
    service.configure({ ...base, ...section, model: config.model, cost: config.cost })
  }

  service.setManualLedgerPersistence(async (ledger: ManualLedger) => {
    const settings = ctx.get('settings') as {
      writable: boolean
      mutate(ns: ReturnType<typeof settingsNamespace>, ops: readonly unknown[]): Promise<void>
    } | undefined
    if (settings === undefined || !settings.writable) {
      throw new Error('manual mode requires a writable DSH settings provider')
    }
    await settings.mutate(namespace, [{ op: 'set', path: ['manualLedger'], value: ledger }])
  })

  // Resolve a session id to its cost snapshot. The sessions store is a
  // service in the inject list; the projection registry is read lazily inside
  // the service so a missing registry degrades to zeroed cost.
  const resolveSession = (id: string): { session: unknown; cost: ReturnType<BalanceService['sessionCost']> } | undefined => {
    const sessions = ctx.get('sessions') as { get(sid: string): { id: string } | undefined } | undefined
    const session = sessions?.get(id)
    if (session === undefined) return undefined
    return { session, cost: service.sessionCost(session as never) }
  }

  // The routes are registered while the plugin is enabled; toggling the
  // setting off makes the balance API disappear until it is re-enabled.
  const routes = makeBalanceRoutes(service, resolveSession)
  let disposeRoutes: (() => void) | undefined
  const syncRoutes = (): void => {
    const enabled = current().enabled ?? true
    if (disposeRoutes === undefined && enabled) {
      disposeRoutes = ctx.effect(
        () => {
          const disposers = routes.map((route) => ctx.webServer.register(route))
          return () => { for (const dispose of disposers) dispose() }
        },
        'balance: routes',
      )
    } else if (disposeRoutes !== undefined && !enabled) {
      disposeRoutes()
      disposeRoutes = undefined
    }
  }

  installSettingsSection(ctx, namespace, BALANCE_SETTINGS_SCHEMA, base, {
    setSource: (source) => { current = source },
    onChange: () => {
      applyConfig(current())
      syncRoutes()
    },
    validate: validateBalanceConfig,
  })
  ctx.on('session/created', (session) => {
    // A startup ordering race is harmless: the first manual view retries after
    // the settings namespace is writable. Contain the observer promise here.
    void service.checkpointSession(session).catch(() => undefined)
  })
  syncRoutes()
}
