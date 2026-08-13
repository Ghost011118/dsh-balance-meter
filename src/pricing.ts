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
  cacheReadPerMillion: number
  /** Cache-miss input. */
  inputPerMillion: number
  /** Output. */
  outputPerMillion: number
}

/** Parsed result of the official pricing page. */
export interface PricingSnapshot {
  /** When the page was fetched (epoch ms). */
  fetchedAt: number
  /** Current (pre-peak-rollout) prices per model. */
  current: Record<'flash' | 'pro', ParsedPrices>
  /** Upcoming peak-pricing table per model (present once the page lists it). */
  peak?: Record<'flash' | 'pro', { offPeak: ParsedPrices; peak: ParsedPrices }>
  /** Human-readable fetch/parse error, absent on success. */
  error?: string
}

/** Official pricing page URL (zh-cn). */
export const PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'

/** Number regex: `0.02`, `1`, `2`, `3.0` etc. */
const PRICE_RE = /(\d+(?:\.\d+)?)\s*元/g

/** Strip HTML tags to plain text (keeps cell order). */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Parse one price cell text like `0.02元` into a number; NaN when absent. */
function parsePriceCell(text: string): number | undefined {
  const m = PRICE_RE.exec(text)
  if (m === null) return undefined
  const value = Number(m[1])
  return Number.isFinite(value) ? value : undefined
}

/**
 * Parse the current single-price table: three rows labeled with the bucket
 * names, each carrying the flash and pro price cells.
 */
function parseCurrentTable(html: string): Record<'flash' | 'pro', ParsedPrices> | undefined {
  // Isolate the first pricing table block: from the first "价格" marker row
  // to the "并发限制" row.
  const hit = /百万tokens输入（缓存命中）([\s\S]{0,400}?)百万tokens输入（缓存未命中）([\s\S]{0,400}?)百万tokens输出([\s\S]{0,400}?)(?:并发限制|<\/table)/i.exec(stripHtml(html))
  if (hit === null) return undefined
  const cacheReadCell = hit[1]
  const inputCell = hit[2]
  const outputCell = hit[3]
  const cacheReadFlash = parsePriceCell(cacheReadCell)
  const cacheReadPro = parsePriceCell(cacheReadCell.replace(/^\s*(\d+(?:\.\d+)?元)/, ''))
  const inputFlash = parsePriceCell(inputCell)
  const inputPro = parsePriceCell(inputCell.replace(/^\s*(\d+(?:\.\d+)?元)/, ''))
  const outputFlash = parsePriceCell(outputCell)
  const outputPro = parsePriceCell(outputCell.replace(/^\s*(\d+(?:\.\d+)?元)/, ''))
  if (cacheReadFlash === undefined || inputFlash === undefined || outputFlash === undefined) return undefined
  return {
    flash: {
      cacheReadPerMillion: cacheReadFlash,
      inputPerMillion: inputFlash,
      outputPerMillion: outputFlash,
    },
    pro: {
      cacheReadPerMillion: cacheReadPro ?? cacheReadFlash,
      inputPerMillion: inputPro ?? inputFlash,
      outputPerMillion: outputPro ?? outputFlash,
    },
  }
}

/**
 * Parse the upcoming peak-pricing table: model rows with off-peak and peak
 * cells, e.g. `deepseek-v4-flash 空闲时段 0.05 1.5 4.5 高峰时段 0.10 3.0 9.0`.
 */
function parsePeakTable(html: string): Record<'flash' | 'pro', { offPeak: ParsedPrices; peak: ParsedPrices }> | undefined {
  const text = stripHtml(html)
  const flash = /deepseek-v4-flash\s+空闲时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+高峰时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元/i.exec(text)
  const pro = /deepseek-v4-pro\s+空闲时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+高峰时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元/i.exec(text)
  if (flash === null || pro === null) return undefined
  return {
    flash: {
      offPeak: { cacheReadPerMillion: Number(flash[1]), inputPerMillion: Number(flash[2]), outputPerMillion: Number(flash[3]) },
      peak: { cacheReadPerMillion: Number(flash[4]), inputPerMillion: Number(flash[5]), outputPerMillion: Number(flash[6]) },
    },
    pro: {
      offPeak: { cacheReadPerMillion: Number(pro[1]), inputPerMillion: Number(pro[2]), outputPerMillion: Number(pro[3]) },
      peak: { cacheReadPerMillion: Number(pro[4]), inputPerMillion: Number(pro[5]), outputPerMillion: Number(pro[6]) },
    },
  }
}

/**
 * Fetch and parse the official pricing page.
 * @param fetchImpl - fetch-compatible function (injected for testability).
 * @param timeoutMs - abort timeout.
 * @returns the parsed snapshot; `error` is set when fetch/parse failed.
 */
export async function fetchPricing(
  fetchImpl: (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }> = globalThis.fetch,
  timeoutMs = 15_000,
): Promise<PricingSnapshot> {
  const fetchedAt = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Awaited<ReturnType<typeof fetchImpl>>
    try {
      response = await fetchImpl(PRICING_URL, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      return { fetchedAt, current: fallbackCurrent(), error: `pricing page HTTP ${response.status}` }
    }
    const html = await response.text()
    const current = parseCurrentTable(html)
    if (current === undefined) {
      return { fetchedAt, current: fallbackCurrent(), error: 'pricing table not found' }
    }
    return {
      fetchedAt,
      current,
      ...(parsePeakTable(html) === undefined ? {} : { peak: parsePeakTable(html) }),
    }
  } catch (error) {
    return {
      fetchedAt,
      current: fallbackCurrent(),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Built-in fallback (deepseek-v4-flash current official prices). */
function fallbackCurrent(): Record<'flash' | 'pro', ParsedPrices> {
  return {
    flash: { cacheReadPerMillion: 0.02, inputPerMillion: 1, outputPerMillion: 2 },
    pro: { cacheReadPerMillion: 0.025, inputPerMillion: 3, outputPerMillion: 6 },
  }
}

/**
 * Whether the current moment is a peak-pricing hour in Beijing time:
 * 09:00-12:00 and 14:00-18:00 (peak); everything else is off-peak.
 */
export function isPeakHour(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  if (Number.isNaN(hour)) return false
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}
