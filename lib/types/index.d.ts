/**
 * dsh-balance-meter host half — mounts the balance service and its HTTP routes.
 * The browser half (the `./client` entry) reads the DeepSeek account balance
 * and the current session's estimated cost through the same-origin
 * `/api/balance` JSON endpoints. Install via
 * `dsh plugin --profile web add link:<dsh-web-ui>/packages/dsh-balance-meter`; the
 * cordis.patch.yml inserts this plugin row.
 * @module dsh-balance-meter
 */
import { Context } from '@deepseek-ai/cordis';
import z from 'schemastery';
import { type BalanceConfig } from './service.ts';
export { BalanceService } from './service.ts';
export type { BalanceConfig, BalanceInfo, BalanceResponse, BalanceView, SessionCost } from './service.ts';
export { BALANCE_API_PREFIX, makeBalanceRoutes } from './routes.ts';
export { DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_REFRESH_INTERVAL_SECONDS, } from './service.ts';
export { resolveCostConfig, costOfUsage, costOfTokens, DEFAULT_COST_CONFIG, FLASH_COST_CONFIG, PRO_COST_CONFIG } from './cost.ts';
export type { CostBreakdown, CostConfig } from './cost.ts';
export { fetchPricing, isPeakHour, PRICING_URL } from './pricing.ts';
export type { ParsedPrices, PricingSnapshot } from './pricing.ts';
/** Settings namespace of the balance capability. */
export declare const BALANCE_SETTINGS_NAMESPACE = "balance";
/** Settings section schema: what the web settings surface edits. */
export declare const BALANCE_SETTINGS_SCHEMA: z<Schemastery.ObjectS<{
    apiKeyEnv: z<string, string>;
    baseUrl: z<string, string>;
    refreshIntervalSeconds: z<number, number>;
    enabled: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    apiKeyEnv: z<string, string>;
    baseUrl: z<string, string>;
    refreshIntervalSeconds: z<number, number>;
    enabled: z<boolean, boolean>;
}>>;
/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export declare const name = "balance";
/** Services required before the balance service can answer. */
export declare const inject: string[];
/** Register the balance service and its API routes on the context. */
export declare function apply(ctx: Context, config?: BalanceConfig): void;
//# sourceMappingURL=index.d.ts.map