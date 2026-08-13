import { Service } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
//#region src/cost.ts
/** deepseek-v4-flash official prices (CNY per 1M tokens). */
const FLASH_COST_CONFIG = {
	inputPerMillion: 1,
	cacheReadPerMillion: .02,
	cacheWritePerMillion: 0,
	outputPerMillion: 2,
	currency: "CNY"
};
/** deepseek-v4-pro official prices (CNY per 1M tokens). */
const PRO_COST_CONFIG = {
	inputPerMillion: 3,
	cacheReadPerMillion: .025,
	cacheWritePerMillion: 0,
	outputPerMillion: 6,
	currency: "CNY"
};
/** The default pricing preset (deepseek-v4-flash). */
const DEFAULT_COST_CONFIG = FLASH_COST_CONFIG;
/** Resolve a partial cost config against the defaults. */
function resolveCostConfig(config = {}) {
	return {
		inputPerMillion: config.inputPerMillion ?? DEFAULT_COST_CONFIG.inputPerMillion,
		cacheReadPerMillion: config.cacheReadPerMillion ?? DEFAULT_COST_CONFIG.cacheReadPerMillion,
		cacheWritePerMillion: config.cacheWritePerMillion ?? DEFAULT_COST_CONFIG.cacheWritePerMillion,
		outputPerMillion: config.outputPerMillion ?? DEFAULT_COST_CONFIG.outputPerMillion,
		currency: config.currency ?? DEFAULT_COST_CONFIG.currency
	};
}
/** Cost of a token count at a per-million price. */
function costOfTokens(count, perMillion) {
	if (count <= 0 || !Number.isFinite(count)) return 0;
	return count / 1e6 * perMillion;
}
/** Total cost of one provider usage record. */
function costOfUsage(usage, config) {
	return costOfTokens(usage.inputTokens, config.inputPerMillion) + costOfTokens(usage.cacheReadTokens ?? 0, config.cacheReadPerMillion) + costOfTokens(usage.cacheWriteTokens ?? 0, config.cacheWritePerMillion) + costOfTokens(usage.outputTokens, config.outputPerMillion);
}
//#endregion
//#region src/pricing.ts
/** Official pricing page URL (zh-cn). */
const PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
/** Number regex: `0.02`, `1`, `2`, `3.0` etc. */
const PRICE_RE = /(\d+(?:\.\d+)?)\s*元/g;
/** Strip HTML tags to plain text (keeps cell order). */
function stripHtml(html) {
	return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
}
/** Parse one price cell text like `0.02元` into a number; NaN when absent. */
function parsePriceCell(text) {
	const m = PRICE_RE.exec(text);
	if (m === null) return void 0;
	const value = Number(m[1]);
	return Number.isFinite(value) ? value : void 0;
}
/**
* Parse the current single-price table: three rows labeled with the bucket
* names, each carrying the flash and pro price cells.
*/
function parseCurrentTable(html) {
	const hit = /百万tokens输入（缓存命中）([\s\S]{0,400}?)百万tokens输入（缓存未命中）([\s\S]{0,400}?)百万tokens输出([\s\S]{0,400}?)(?:并发限制|<\/table)/i.exec(stripHtml(html));
	if (hit === null) return void 0;
	const cacheReadCell = hit[1];
	const inputCell = hit[2];
	const outputCell = hit[3];
	const cacheReadFlash = parsePriceCell(cacheReadCell);
	const cacheReadPro = parsePriceCell(cacheReadCell.replace(/^\s*(\d+(?:\.\d+)?元)/, ""));
	const inputFlash = parsePriceCell(inputCell);
	const inputPro = parsePriceCell(inputCell.replace(/^\s*(\d+(?:\.\d+)?元)/, ""));
	const outputFlash = parsePriceCell(outputCell);
	const outputPro = parsePriceCell(outputCell.replace(/^\s*(\d+(?:\.\d+)?元)/, ""));
	if (cacheReadFlash === void 0 || inputFlash === void 0 || outputFlash === void 0) return void 0;
	return {
		flash: {
			cacheReadPerMillion: cacheReadFlash,
			inputPerMillion: inputFlash,
			outputPerMillion: outputFlash
		},
		pro: {
			cacheReadPerMillion: cacheReadPro ?? cacheReadFlash,
			inputPerMillion: inputPro ?? inputFlash,
			outputPerMillion: outputPro ?? outputFlash
		}
	};
}
/**
* Parse the upcoming peak-pricing table: model rows with off-peak and peak
* cells, e.g. `deepseek-v4-flash 空闲时段 0.05 1.5 4.5 高峰时段 0.10 3.0 9.0`.
*/
function parsePeakTable(html) {
	const text = stripHtml(html);
	const flash = /deepseek-v4-flash\s+空闲时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+高峰时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元/i.exec(text);
	const pro = /deepseek-v4-pro\s+空闲时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+高峰时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元/i.exec(text);
	if (flash === null || pro === null) return void 0;
	return {
		flash: {
			offPeak: {
				cacheReadPerMillion: Number(flash[1]),
				inputPerMillion: Number(flash[2]),
				outputPerMillion: Number(flash[3])
			},
			peak: {
				cacheReadPerMillion: Number(flash[4]),
				inputPerMillion: Number(flash[5]),
				outputPerMillion: Number(flash[6])
			}
		},
		pro: {
			offPeak: {
				cacheReadPerMillion: Number(pro[1]),
				inputPerMillion: Number(pro[2]),
				outputPerMillion: Number(pro[3])
			},
			peak: {
				cacheReadPerMillion: Number(pro[4]),
				inputPerMillion: Number(pro[5]),
				outputPerMillion: Number(pro[6])
			}
		}
	};
}
/**
* Fetch and parse the official pricing page.
* @param fetchImpl - fetch-compatible function (injected for testability).
* @param timeoutMs - abort timeout.
* @returns the parsed snapshot; `error` is set when fetch/parse failed.
*/
async function fetchPricing(fetchImpl = globalThis.fetch, timeoutMs = 15e3) {
	const fetchedAt = Date.now();
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let response;
		try {
			response = await fetchImpl(PRICING_URL, { signal: controller.signal });
		} finally {
			clearTimeout(timer);
		}
		if (!response.ok) return {
			fetchedAt,
			current: fallbackCurrent(),
			error: `pricing page HTTP ${response.status}`
		};
		const html = await response.text();
		const current = parseCurrentTable(html);
		if (current === void 0) return {
			fetchedAt,
			current: fallbackCurrent(),
			error: "pricing table not found"
		};
		return {
			fetchedAt,
			current,
			...parsePeakTable(html) === void 0 ? {} : { peak: parsePeakTable(html) }
		};
	} catch (error) {
		return {
			fetchedAt,
			current: fallbackCurrent(),
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
/** Built-in fallback (deepseek-v4-flash current official prices). */
function fallbackCurrent() {
	return {
		flash: {
			cacheReadPerMillion: .02,
			inputPerMillion: 1,
			outputPerMillion: 2
		},
		pro: {
			cacheReadPerMillion: .025,
			inputPerMillion: 3,
			outputPerMillion: 6
		}
	};
}
/**
* Whether the current moment is a peak-pricing hour in Beijing time:
* 09:00-12:00 and 14:00-18:00 (peak); everything else is off-peak.
*/
function isPeakHour(now = /* @__PURE__ */ new Date()) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Shanghai",
		hour: "numeric",
		hour12: false
	}).formatToParts(now);
	const hour = Number(parts.find((p) => p.type === "hour")?.value);
	if (Number.isNaN(hour)) return false;
	return hour >= 9 && hour < 12 || hour >= 14 && hour < 18;
}
//#endregion
//#region src/service.ts
/**
* dsh-balance-meter host service — the `balance.*` RPC domain. Resolves the DeepSeek
* API key through the DSH credentials seam (`ctx.credentials`, ref
* `DEEPSEEK_API_KEY`) and queries the official Get User Balance endpoint,
* caching the result so the browser readout can poll without spamming the
* provider.
* @module dsh-balance-meter/service
*/
/** DeepSeek API base URL. */
const DEFAULT_BASE_URL = "https://api.deepseek.com";
/** Default credential reference for the DeepSeek API key. */
const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
/** Default provider query pacing. */
const DEFAULT_REFRESH_INTERVAL_SECONDS = 30;
/** Official peak-pricing rollout: 2026-08-17 00:00 Beijing time (UTC+8). */
const PEAK_PRICING_START_MS = Date.UTC(2026, 7, 16, 16, 0, 0);
/** Parse a base URL into a safe `{ origin, pathPrefix }` pair. */
function parseBaseUrl(raw) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`dsh-balance-meter: invalid baseUrl "${raw}"`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`dsh-balance-meter: baseUrl must be http(s), got "${url.protocol}"`);
	let prefix = url.pathname.replace(/\/+$/, "");
	return {
		origin: url.origin,
		prefix
	};
}
/**
* DeepSeek Get User Balance client. Resolution of the API key re-reads the
* credentials seam on every query so a changed key reaches the next query
* without a plugin restart.
*/
var BalanceService = class extends Service {
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
		super(ctx, "balance");
		this.apiKeyEnv = credentialRef(config.apiKeyEnv ?? "DEEPSEEK_API_KEY");
		this.baseUrl = config.baseUrl ?? "https://api.deepseek.com";
		this.refreshIntervalMs = Math.max(0, (config.refreshIntervalSeconds ?? 30) * 1e3);
		this.model = config.model ?? "flash";
		this.costConfig = this.resolveCostFromPreset(config);
		this.enabled = config.enabled ?? true;
		this.refreshPricing();
		const cadenceMs = (config.pricingRefreshHours ?? 6) * 36e5;
		this.pricingTimer = setInterval(() => {
			this.refreshPricing();
		}, cadenceMs);
		this.pricingTimer.unref?.();
	}
	/** Resolve the cost config from the model preset + explicit overrides. */
	resolveCostFromPreset(config) {
		const preset = this.model === "pro" ? PRO_COST_CONFIG : FLASH_COST_CONFIG;
		return resolveCostConfig({
			inputPerMillion: config.cost?.inputPerMillion ?? preset.inputPerMillion,
			cacheReadPerMillion: config.cost?.cacheReadPerMillion ?? preset.cacheReadPerMillion,
			cacheWritePerMillion: config.cost?.cacheWritePerMillion ?? preset.cacheWritePerMillion,
			outputPerMillion: config.cost?.outputPerMillion ?? preset.outputPerMillion,
			currency: config.cost?.currency ?? preset.currency
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
		if (!this.enabled) return {
			fetchedAt: Date.now(),
			available: false,
			balances: [],
			error: "disabled"
		};
		const now = Date.now();
		if (this.cached !== void 0 && now - this.cachedAt < this.refreshIntervalMs && this.refreshIntervalMs > 0) return this.cached;
		if (this.inflight !== void 0) return this.inflight;
		this.inflight = this.query().then((view) => {
			this.cached = view;
			this.cachedAt = Date.now();
			return view;
		}).finally(() => {
			this.inflight = void 0;
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
		const registry = this.ctx.get("sessionProjections");
		let usage;
		if (registry !== void 0) {
			const value = registry.snapshot(session).values.tokenUsage;
			if (value !== null && typeof value === "object") usage = value;
		}
		const buckets = usage ?? {
			uncachedInputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0
		};
		const config = this.effectiveCostConfig();
		const cost = costOfUsage({
			inputTokens: buckets.uncachedInputTokens,
			outputTokens: buckets.outputTokens,
			cacheReadTokens: buckets.cacheReadTokens,
			cacheWriteTokens: buckets.cacheWriteTokens
		}, config);
		return {
			...buckets,
			cost,
			currency: config.currency,
			breakdown: {
				input: costOfTokens(buckets.uncachedInputTokens, config.inputPerMillion),
				cacheRead: costOfTokens(buckets.cacheReadTokens, config.cacheReadPerMillion),
				cacheWrite: costOfTokens(buckets.cacheWriteTokens, config.cacheWritePerMillion),
				output: costOfTokens(buckets.outputTokens, config.outputPerMillion)
			}
		};
	}
	/**
	* The cost config in effect right now: auto-fetched official prices when
	* available (peak table applied by the current Beijing-hour band once the
	* peak rollout is live), otherwise the configured preset.
	*/
	effectiveCostConfig() {
		const snapshot = this.pricingSnapshot;
		if (snapshot !== void 0 && snapshot.error === void 0) {
			const prices = snapshot.current[this.model];
			let cacheRead = prices.cacheReadPerMillion;
			let input = prices.inputPerMillion;
			let output = prices.outputPerMillion;
			const peak = snapshot.peak?.[this.model];
			if (peak !== void 0 && Date.now() >= PEAK_PRICING_START_MS) {
				const band = isPeakHour() ? peak.peak : peak.offPeak;
				cacheRead = band.cacheReadPerMillion;
				input = band.inputPerMillion;
				output = band.outputPerMillion;
			}
			return resolveCostConfig({
				inputPerMillion: input,
				cacheReadPerMillion: cacheRead,
				outputPerMillion: output,
				currency: this.costConfig.currency
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
		if (key === void 0) return {
			fetchedAt,
			available: false,
			balances: [],
			error: `no API key (store ${this.apiKeyEnv} via the credentials seam, or export it in the environment)`
		};
		try {
			const { origin, prefix } = parseBaseUrl(this.baseUrl);
			const url = `${origin}${prefix}/user/balance`;
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 15e3);
			let response;
			try {
				response = await fetch(url, {
					method: "GET",
					headers: {
						authorization: `Bearer ${key}`,
						accept: "application/json"
					},
					signal: controller.signal
				});
			} finally {
				clearTimeout(timer);
			}
			if (!response.ok) {
				const body = await response.text().catch(() => "");
				return {
					fetchedAt,
					available: false,
					balances: [],
					error: `Get User Balance failed: HTTP ${response.status}${body ? ` — ${truncate(body, 200)}` : ""}`
				};
			}
			const payload = await response.json();
			const buckets = Array.isArray(payload.balance_infos) ? payload.balance_infos.map((b) => ({
				currency: String(b.currency ?? ""),
				total_balance: String(b.total_balance ?? "0"),
				granted_balance: String(b.granted_balance ?? "0"),
				topped_up_balance: String(b.topped_up_balance ?? "0")
			})).filter((b) => b.currency !== "") : [];
			const total = buckets.length === 1 ? Number(buckets[0].total_balance) : void 0;
			return {
				fetchedAt,
				available: payload.is_available !== false,
				balances: buckets,
				...total === void 0 || Number.isNaN(total) ? {} : {
					total,
					currency: buckets[0].currency
				}
			};
		} catch (error) {
			return {
				fetchedAt,
				available: false,
				balances: [],
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	/** Resolve the current API key through the credentials seam or the environment. */
	async resolveApiKey() {
		const credentials = this.ctx.get("credentials");
		if (credentials !== void 0) {
			const hit = await credentials.resolve(this.apiKeyEnv);
			if (hit !== void 0 && hit.value.length > 0) return hit.value;
		}
		const value = this.ctx.get("launchEnvironment")?.get(String(this.apiKeyEnv));
		if (value !== void 0 && value.value.length > 0) return value.value;
		const envFallback = process.env[String(this.apiKeyEnv)];
		if (typeof envFallback === "string" && envFallback.length > 0) return envFallback;
	}
};
/** Bound a provider error body for reporting. */
function truncate(text, max) {
	return text.length <= max ? text : `${text.slice(0, max)}..`;
}
//#endregion
export { PRICING_URL as a, DEFAULT_COST_CONFIG as c, costOfTokens as d, costOfUsage as f, DEFAULT_REFRESH_INTERVAL_SECONDS as i, FLASH_COST_CONFIG as l, DEFAULT_API_KEY_ENV as n, fetchPricing as o, resolveCostConfig as p, DEFAULT_BASE_URL as r, isPeakHour as s, BalanceService as t, PRO_COST_CONFIG as u };
