/**
 * dsh-balance-meter pricing fetcher — pulls the official DeepSeek pricing page
 * (api-docs.deepseek.com/zh-cn/quick_start/pricing/) and parses both the
 * current prices and the upcoming peak/off-peak table, so price changes and
 * the 2026-08-17 peak-pricing rollout never require a plugin update.
 *
 * The parser is deliberately tolerant: it matches price cells next to the
 * bucket labels and model names anywhere in the HTML, so reordering or
 * rewording still yields values when the numbers are present; failures
 * degrade to the built-in presets rather than throwing.
 * @module dsh-balance-meter/pricing
 */
/** One model's parsed prices (CNY per 1M tokens). */
export interface ParsedPrices {
    /** Cache-hit input. */
    cacheReadPerMillion: number;
    /** Cache-miss input. */
    inputPerMillion: number;
    /** Output. */
    outputPerMillion: number;
}
/** Parsed result of the official pricing page. */
export interface PricingSnapshot {
    /** When the page was fetched (epoch ms). */
    fetchedAt: number;
    /** Current (pre-peak-rollout) prices per model. */
    current: Record<'flash' | 'pro', ParsedPrices>;
    /** Upcoming peak-pricing table per model (present once the page lists it). */
    peak?: Record<'flash' | 'pro', {
        offPeak: ParsedPrices;
        peak: ParsedPrices;
    }>;
    /** Human-readable fetch/parse error, absent on success. */
    error?: string;
}
/** Official pricing page URL (zh-cn). */
export declare const PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
/**
 * Fetch and parse the official pricing page.
 * @param fetchImpl - fetch-compatible function (injected for testability).
 * @param timeoutMs - abort timeout.
 * @returns the parsed snapshot; `error` is set when fetch/parse failed.
 */
export declare function fetchPricing(fetchImpl?: (url: string, init?: {
    signal?: AbortSignal;
}) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
}>, timeoutMs?: number): Promise<PricingSnapshot>;
/**
 * Whether the current moment is a peak-pricing hour in Beijing time:
 * 09:00-12:00 and 14:00-18:00 (peak); everything else is off-peak.
 */
export declare function isPeakHour(now?: Date): boolean;
//# sourceMappingURL=pricing.d.ts.map