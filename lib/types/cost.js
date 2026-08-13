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
/** deepseek-v4-flash official prices (CNY per 1M tokens). */
export const FLASH_COST_CONFIG = {
    inputPerMillion: 1,
    cacheReadPerMillion: 0.02,
    cacheWritePerMillion: 0,
    outputPerMillion: 2,
    currency: 'CNY',
};
/** deepseek-v4-pro official prices (CNY per 1M tokens). */
export const PRO_COST_CONFIG = {
    inputPerMillion: 3,
    cacheReadPerMillion: 0.025,
    cacheWritePerMillion: 0,
    outputPerMillion: 6,
    currency: 'CNY',
};
/** The default pricing preset (deepseek-v4-flash). */
export const DEFAULT_COST_CONFIG = FLASH_COST_CONFIG;
/** Resolve a partial cost config against the defaults. */
export function resolveCostConfig(config = {}) {
    return {
        inputPerMillion: config.inputPerMillion ?? DEFAULT_COST_CONFIG.inputPerMillion,
        cacheReadPerMillion: config.cacheReadPerMillion ?? DEFAULT_COST_CONFIG.cacheReadPerMillion,
        cacheWritePerMillion: config.cacheWritePerMillion ?? DEFAULT_COST_CONFIG.cacheWritePerMillion,
        outputPerMillion: config.outputPerMillion ?? DEFAULT_COST_CONFIG.outputPerMillion,
        currency: config.currency ?? DEFAULT_COST_CONFIG.currency,
    };
}
/** Cost of a token count at a per-million price. */
export function costOfTokens(count, perMillion) {
    if (count <= 0 || !Number.isFinite(count))
        return 0;
    return (count / 1_000_000) * perMillion;
}
/** Total cost of one provider usage record. */
export function costOfUsage(usage, config) {
    return costOfTokens(usage.inputTokens, config.inputPerMillion)
        + costOfTokens(usage.cacheReadTokens ?? 0, config.cacheReadPerMillion)
        + costOfTokens(usage.cacheWriteTokens ?? 0, config.cacheWritePerMillion)
        + costOfTokens(usage.outputTokens, config.outputPerMillion);
}
/** Per-bucket breakdown of one usage record. */
export function breakdownOfUsage(usage, config) {
    const input = costOfTokens(usage.inputTokens, config.inputPerMillion);
    const cacheRead = costOfTokens(usage.cacheReadTokens ?? 0, config.cacheReadPerMillion);
    const cacheWrite = costOfTokens(usage.cacheWriteTokens ?? 0, config.cacheWritePerMillion);
    const output = costOfTokens(usage.outputTokens, config.outputPerMillion);
    return {
        input,
        cacheRead,
        cacheWrite,
        output,
        total: input + cacheRead + cacheWrite + output,
    };
}
