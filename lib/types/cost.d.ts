/**
 * dsh-balance-meter cost math — pure token-to-amount conversion for the DeepSeek
 * billing buckets. Prices are per one million tokens, expressed in the
 * account currency (CNY by default). Everything here is a pure function so
 * it is unit-testable without a host.
 *
 * Official pricing (api-docs.deepseek.com, current until 2026-08-17):
 *   deepseek-v4-flash: cache-hit input 0.02 CNY / 1M, cache-miss input 1 CNY
 *                      / 1M, output 2 CNY / 1M
 *   deepseek-v4-pro:   cache-hit input 0.025 CNY / 1M, cache-miss input 3
 *                      CNY / 1M, output 6 CNY / 1M
 * DeepSeek bills only three buckets; writing to the cache is not billed
 * separately, so cache-write tokens are priced at zero by default.
 * @module dsh-balance-meter/cost
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm';
/** Per-million-token price configuration for the billing buckets. */
export interface CostConfig {
    /** Cache-miss input tokens (CNY per 1M tokens). */
    inputPerMillion?: number;
    /** Cache-hit input tokens (CNY per 1M tokens). */
    cacheReadPerMillion?: number;
    /** Cache-write input tokens (CNY per 1M tokens; 0 when not billed). */
    cacheWritePerMillion?: number;
    /** Output tokens (CNY per 1M tokens). */
    outputPerMillion?: number;
    /** Display currency (default CNY). */
    currency?: string;
}
/** deepseek-v4-flash official prices (CNY per 1M tokens). */
export declare const FLASH_COST_CONFIG: Required<CostConfig>;
/** deepseek-v4-pro official prices (CNY per 1M tokens). */
export declare const PRO_COST_CONFIG: Required<CostConfig>;
/** The default pricing preset (deepseek-v4-flash). */
export declare const DEFAULT_COST_CONFIG: Required<CostConfig>;
/** Resolve a partial cost config against the defaults. */
export declare function resolveCostConfig(config?: CostConfig): Required<CostConfig>;
/** Cost of a token count at a per-million price. */
export declare function costOfTokens(count: number, perMillion: number): number;
/** Total cost of one provider usage record. */
export declare function costOfUsage(usage: TokenUsage, config: Required<CostConfig>): number;
/** Per-bucket cost breakdown of one usage record. */
export interface CostBreakdown {
    /** Cache-miss input cost. */
    input: number;
    /** Cache-hit input cost. */
    cacheRead: number;
    /** Cache-write cost. */
    cacheWrite: number;
    /** Output cost. */
    output: number;
    /** Sum of the four buckets. */
    total: number;
}
/** Per-bucket breakdown of one usage record. */
export declare function breakdownOfUsage(usage: TokenUsage, config: Required<CostConfig>): CostBreakdown;
//# sourceMappingURL=cost.d.ts.map