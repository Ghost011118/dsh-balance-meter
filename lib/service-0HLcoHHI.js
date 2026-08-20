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
/** Number regex: `0.02`, `1`, `2`, `3.0` etc. Deliberately non-global: a
* shared global regex leaks `lastIndex` across `exec` calls and would skip the
* second price cell (the pro price), silently repricing pro sessions at the
* flash rate. */
const PRICE_RE = /(\d+(?:\.\d+)?)\s*元/;
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
* dsh-balance-meter host service — the `balance.*` RPC domain. Supports the
* official DeepSeek balance endpoint, explicitly labelled proxy-compatible
* endpoints, and a locally persisted manual balance ledger.
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
/** SSRF / length guard for the base URL. */
const MAX_BASE_URL_LENGTH = 256;
/** Default local/proxy display currency. */
const DEFAULT_CURRENCY = "CNY";
/** Parse a base URL into a safe `{ origin, pathPrefix }` pair. */
function parseBaseUrl(raw) {
	if (raw.length > MAX_BASE_URL_LENGTH) throw new Error(`dsh-balance-meter: baseUrl exceeds ${MAX_BASE_URL_LENGTH} characters`);
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`dsh-balance-meter: invalid baseUrl "${raw}"`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`dsh-balance-meter: baseUrl must be http(s), got "${url.protocol}"`);
	const prefix = url.pathname.replace(/\/+$/, "");
	return {
		origin: url.origin,
		prefix
	};
}
/** Whether a URL is the official DeepSeek API origin. */
function isOfficialBaseUrl(raw) {
	try {
		return new URL(raw).origin === new URL(DEFAULT_BASE_URL).origin;
	} catch {
		return false;
	}
}
/** Preserve legacy custom `baseUrl` support while labelling it honestly. */
function resolveBalanceSource(config) {
	if (config.source !== void 0) return config.source;
	return isOfficialBaseUrl(config.baseUrl ?? "https://api.deepseek.com") ? "official" : "proxy";
}
/** Cross-field validation shared by composition and the writable settings seam. */
function validateBalanceConfig(config) {
	const baseUrl = config.baseUrl ?? "https://api.deepseek.com";
	const source = resolveBalanceSource(config);
	parseBaseUrl(baseUrl);
	if (source === "official" && !isOfficialBaseUrl(baseUrl)) throw new Error("source \"official\" requires the https://api.deepseek.com origin; use source \"proxy\" for a relay");
	if (config.manualBalance !== void 0 && (!Number.isFinite(config.manualBalance) || config.manualBalance < 0)) throw new Error("manualBalance must be a finite non-negative number");
	const manualCurrency = normalizeCurrency(config.manualCurrency);
	normalizeCurrency(config.proxyCurrency);
	if (source === "manual" && config.manualBalance === void 0) throw new Error("source \"manual\" requires manualBalance");
	const costCurrency = normalizeCurrency(config.cost?.currency);
	if (source === "manual" && manualCurrency !== costCurrency) throw new Error(`manualCurrency ${manualCurrency} must match the session-cost currency ${costCurrency}`);
}
/** Validate and normalize a user-visible currency. */
function normalizeCurrency(value, fallback = "CNY") {
	const currency = (value ?? fallback).trim().toUpperCase();
	if (!/^[A-Z][A-Z0-9_-]{0,11}$/.test(currency)) throw new Error(`dsh-balance-meter: invalid currency "${value ?? ""}"`);
	return currency;
}
/** Resolve one own-property dot path without allowing prototype traversal. */
function valueAtPath(root, path) {
	const segments = path.split(".").map((part) => part.trim()).filter(Boolean);
	if (segments.length === 0 || segments.some((part) => part === "__proto__" || part === "prototype" || part === "constructor")) throw new Error(`proxyBalancePath "${path}" is invalid`);
	let value = root;
	for (const segment of segments) {
		if (value === null || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, segment)) throw new Error(`proxy balance path "${path}" was not found`);
		value = value[segment];
	}
	return value;
}
/** Parse an official or explicitly proxy-labelled balance response. */
function parseProviderBalance(payload, source, options = {}) {
	const fetchedAt = options.fetchedAt ?? Date.now();
	const record = payload !== null && typeof payload === "object" ? payload : void 0;
	if (record !== void 0 && Array.isArray(record.balance_infos)) {
		const buckets = record.balance_infos.map((value) => {
			const bucket = value;
			return {
				currency: String(bucket.currency ?? ""),
				total_balance: String(bucket.total_balance ?? "0"),
				granted_balance: String(bucket.granted_balance ?? "0"),
				topped_up_balance: String(bucket.topped_up_balance ?? "0")
			};
		}).filter((bucket) => bucket.currency !== "");
		if (source === "proxy" && buckets.length === 0) throw new Error("proxy balance response contained no usable balance_infos");
		const total = buckets.length === 1 ? Number(buckets[0].total_balance) : void 0;
		if (total !== void 0 && !Number.isFinite(total)) throw new Error(`${source} balance response contained a non-numeric total_balance`);
		return {
			fetchedAt,
			source,
			available: record.is_available !== false,
			balances: buckets,
			...total === void 0 ? {} : {
				total,
				currency: buckets[0].currency
			}
		};
	}
	if (source === "official") throw new Error("official balance response did not match the DeepSeek balance_infos schema");
	if (options.balancePath === void 0 || options.balancePath.trim() === "") throw new Error("proxy balance response schema is unknown; configure proxyBalancePath");
	const raw = valueAtPath(payload, options.balancePath);
	if (typeof raw !== "number" && typeof raw !== "string" || typeof raw === "string" && raw.trim() === "") throw new Error(`proxy balance path "${options.balancePath}" is not numeric`);
	const total = typeof raw === "number" ? raw : Number(raw);
	if (!Number.isFinite(total)) throw new Error(`proxy balance path "${options.balancePath}" is not numeric`);
	return {
		fetchedAt,
		source: "proxy",
		available: total > 0,
		balances: [],
		total,
		currency: normalizeCurrency(options.currency)
	};
}
/** Create a local ledger whose existing sessions are already checkpointed. */
function createManualLedger(initialBalance, currency, baselineAt, sessions = {}) {
	if (!Number.isFinite(initialBalance) || initialBalance < 0) throw new Error("manualBalance must be a finite non-negative number");
	return {
		version: 1,
		initialBalance,
		currency: normalizeCurrency(currency),
		baselineAt,
		remaining: initialBalance,
		spent: 0,
		sessions
	};
}
/** Advance one session exactly once by charging only positive token deltas. */
function advanceManualLedger(ledger, sessionId, sessionCreatedAt, usage, cost) {
	const previous = ledger.sessions[sessionId];
	const checkpoint = previous === void 0 ? { ...usage } : {
		uncachedInputTokens: Math.max(previous.uncachedInputTokens, usage.uncachedInputTokens),
		outputTokens: Math.max(previous.outputTokens, usage.outputTokens),
		cacheReadTokens: Math.max(previous.cacheReadTokens, usage.cacheReadTokens),
		cacheWriteTokens: Math.max(previous.cacheWriteTokens, usage.cacheWriteTokens)
	};
	if (previous === void 0 && sessionCreatedAt <= ledger.baselineAt) return {
		...ledger,
		sessions: {
			...ledger.sessions,
			[sessionId]: checkpoint
		}
	};
	const before = previous ?? {
		uncachedInputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0
	};
	const charged = costOfUsage({
		inputTokens: checkpoint.uncachedInputTokens - before.uncachedInputTokens,
		outputTokens: checkpoint.outputTokens - before.outputTokens,
		cacheReadTokens: checkpoint.cacheReadTokens - before.cacheReadTokens,
		cacheWriteTokens: checkpoint.cacheWriteTokens - before.cacheWriteTokens
	}, cost);
	if (previous !== void 0 && charged === 0 && previous.uncachedInputTokens === checkpoint.uncachedInputTokens && previous.outputTokens === checkpoint.outputTokens && previous.cacheReadTokens === checkpoint.cacheReadTokens && previous.cacheWriteTokens === checkpoint.cacheWriteTokens) return ledger;
	return {
		...ledger,
		remaining: ledger.remaining - charged,
		spent: ledger.spent + charged,
		sessions: {
			...ledger.sessions,
			[sessionId]: checkpoint
		}
	};
}
/** Project a ledger into the browser-safe summary (never includes checkpoints). */
function manualLedgerView(ledger, fetchedAt = Date.now()) {
	return {
		fetchedAt,
		source: "manual",
		available: ledger.remaining > 0,
		balances: [],
		total: ledger.remaining,
		currency: ledger.currency,
		initialBalance: ledger.initialBalance,
		localSpent: ledger.spent,
		baselineAt: ledger.baselineAt
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
	source;
	balanceEndpoint;
	proxyBalancePath;
	proxyCurrency;
	manualBalance;
	manualCurrency;
	manualLedger;
	persistManualLedger;
	manualQueue = Promise.resolve();
	refreshIntervalMs;
	model;
	/** Explicit per-million price overrides from `config.cost`, applied on top of any model preset. */
	userCostOverrides;
	pricingSnapshot;
	pricingTimer;
	cached;
	cachedAt = 0;
	inflight;
	enabled;
	constructor(ctx, config = {}) {
		super(ctx, "balance");
		this.apiKeyEnv = credentialRef(DEFAULT_API_KEY_ENV);
		this.baseUrl = DEFAULT_BASE_URL;
		this.source = "official";
		this.proxyCurrency = "CNY";
		this.manualCurrency = "CNY";
		this.refreshIntervalMs = 3e4;
		this.model = "auto";
		this.enabled = true;
		this.configure(config);
		this.refreshPricing();
		const cadenceMs = (config.pricingRefreshHours ?? 6) * 36e5;
		this.pricingTimer = setInterval(() => {
			this.refreshPricing();
		}, cadenceMs);
		this.pricingTimer.unref?.();
	}
	/** Apply the current resolved settings snapshot to every live-query field. */
	configure(config) {
		const baseUrl = config.baseUrl ?? "https://api.deepseek.com";
		const source = resolveBalanceSource(config);
		validateBalanceConfig(config);
		const manualCurrency = normalizeCurrency(config.manualCurrency);
		const proxyCurrency = normalizeCurrency(config.proxyCurrency);
		const manualInputChanged = this.manualBalance !== config.manualBalance || this.manualCurrency !== manualCurrency;
		this.apiKeyEnv = credentialRef(config.apiKeyEnv ?? "DEEPSEEK_API_KEY");
		this.baseUrl = baseUrl;
		this.source = source;
		this.balanceEndpoint = config.balanceEndpoint;
		this.proxyBalancePath = config.proxyBalancePath;
		this.proxyCurrency = proxyCurrency;
		this.manualBalance = config.manualBalance;
		this.manualCurrency = manualCurrency;
		this.refreshIntervalMs = Math.max(0, (config.refreshIntervalSeconds ?? 30) * 1e3);
		this.model = config.model ?? "auto";
		this.userCostOverrides = config.cost;
		this.enabled = config.enabled ?? true;
		const candidate = config.manualLedger;
		if (candidate?.version === 1 && candidate.initialBalance === this.manualBalance && candidate.currency === this.manualCurrency) this.manualLedger = candidate;
		else if (manualInputChanged || candidate !== void 0) this.manualLedger = void 0;
		this.cached = void 0;
		this.cachedAt = 0;
	}
	/** Attach the only authorized persistence path: the DSH settings namespace. */
	setManualLedgerPersistence(persist) {
		this.persistManualLedger = persist;
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
	* RPC: most recent balance + usage view. A healthy (error-free) cached view
	* is returned while still fresh; an erroneous view is never reused as fresh,
	* so the next poll re-queries the provider and the readout recovers
	* automatically once the underlying condition clears (without a manual
	* click). Concurrent queries are deduped.
	*/
	async view(session) {
		if (!this.enabled) return {
			fetchedAt: Date.now(),
			source: this.source,
			available: false,
			balances: [],
			error: "disabled"
		};
		if (this.source === "manual") return this.manualView(session);
		const now = Date.now();
		const cached = this.cached;
		if (cached !== void 0 && cached.error === void 0 && now - this.cachedAt < this.refreshIntervalMs && this.refreshIntervalMs > 0) return cached;
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
	async refresh(session) {
		if (this.source === "manual") return this.manualView(session);
		const view = await this.query();
		this.cached = view;
		this.cachedAt = Date.now();
		return view;
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
	sessionCost(session) {
		const buckets = this.sessionUsage(session);
		const { model, pricingKey } = this.resolveModelForSession(session);
		const config = this.effectiveCostConfig(pricingKey);
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
			pricingKey,
			...model === void 0 ? {} : { model },
			breakdown: {
				input: costOfTokens(buckets.uncachedInputTokens, config.inputPerMillion),
				cacheRead: costOfTokens(buckets.cacheReadTokens, config.cacheReadPerMillion),
				cacheWrite: costOfTokens(buckets.cacheWriteTokens, config.cacheWritePerMillion),
				output: costOfTokens(buckets.outputTokens, config.outputPerMillion)
			}
		};
	}
	/** Checkpoint a restored pre-baseline session before it can accrue live usage. */
	async checkpointSession(session) {
		if (this.source !== "manual") return;
		await this.withManualLock(async () => {
			const ledger = await this.ensureManualLedger();
			const id = String(session.id);
			if (ledger.sessions[id] !== void 0 || session.header.createdAt > ledger.baselineAt) return;
			await this.commitManualLedger({
				...ledger,
				sessions: {
					...ledger.sessions,
					[id]: this.sessionUsage(session)
				}
			});
		});
	}
	/** Read DSH's durable cumulative token projection. */
	sessionUsage(session) {
		const registry = this.ctx.get("sessionProjections");
		let usage;
		if (registry !== void 0) {
			const value = registry.snapshot(session).values.tokenUsage;
			if (value !== null && typeof value === "object") usage = value;
		}
		const tokenCount = (value) => {
			const count = Number(value ?? 0);
			return Number.isFinite(count) && count >= 0 ? count : 0;
		};
		return {
			uncachedInputTokens: tokenCount(usage?.uncachedInputTokens),
			outputTokens: tokenCount(usage?.outputTokens),
			cacheReadTokens: tokenCount(usage?.cacheReadTokens),
			cacheWriteTokens: tokenCount(usage?.cacheWriteTokens)
		};
	}
	/**
	* Resolve the pricing preset (and the raw model id, when known) for this
	* session. An explicit configured `model` (`flash`/`pro`) wins over
	* auto-detection; otherwise (`auto`) the session's request header model id is
	* mapped to a preset, falling back to flash when no header exists or the id
	* is not a known DeepSeek family.
	* @param session - the session whose model to resolve.
	*/
	resolveModelForSession(session) {
		if (this.model !== "auto") return { pricingKey: this.model };
		const modelId = (typeof session.requestHeader === "function" ? session.requestHeader() : void 0)?.config?.model;
		if (typeof modelId === "string" && modelId.length > 0) {
			const lower = modelId.toLowerCase();
			if (lower.includes("pro")) return {
				model: modelId,
				pricingKey: "pro"
			};
			if (lower.includes("flash")) return {
				model: modelId,
				pricingKey: "flash"
			};
		}
		return { pricingKey: "flash" };
	}
	/**
	* The cost config in effect right now for one pricing preset: auto-fetched
	* official prices when available (peak table applied by the current
	* Beijing-hour band once the peak rollout is live), otherwise the configured
	* preset for that model.
	* @param pricingKey - the model preset to price for (`flash` or `pro`).
	*/
	effectiveCostConfig(pricingKey = "flash") {
		const snapshot = this.pricingSnapshot;
		if (snapshot !== void 0 && snapshot.error === void 0) {
			const prices = snapshot.current[pricingKey];
			let cacheRead = prices.cacheReadPerMillion;
			let input = prices.inputPerMillion;
			let output = prices.outputPerMillion;
			const peak = snapshot.peak?.[pricingKey];
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
				currency: this.userCostOverrides?.currency ?? this.modelCost(pricingKey).currency
			});
		}
		return resolveCostConfig({
			inputPerMillion: this.applyOverride(pricingKey, "inputPerMillion"),
			cacheReadPerMillion: this.applyOverride(pricingKey, "cacheReadPerMillion"),
			cacheWritePerMillion: pricingKey === "pro" ? PRO_COST_CONFIG.cacheWritePerMillion : FLASH_COST_CONFIG.cacheWritePerMillion,
			outputPerMillion: this.applyOverride(pricingKey, "outputPerMillion"),
			currency: this.userCostOverrides?.currency ?? this.modelCost(pricingKey).currency
		});
	}
	/** One preset field, with any explicit user override applied. */
	applyOverride(pricingKey, field) {
		const override = this.userCostOverrides?.[field];
		if (typeof override === "number") return override;
		return this.modelCost(pricingKey)[field];
	}
	/** The built-in preset prices for one model. */
	modelCost(pricingKey) {
		return pricingKey === "pro" ? PRO_COST_CONFIG : FLASH_COST_CONFIG;
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
	/** Serialize manual ledger reads/writes so concurrent browser polls cannot double-charge. */
	withManualLock(run) {
		const result = this.manualQueue.then(run, run);
		this.manualQueue = result.then(() => void 0, () => void 0);
		return result;
	}
	/** Initialize a new baseline and checkpoint all currently live sessions. */
	async ensureManualLedger() {
		if (this.manualBalance === void 0) throw new Error("manual mode requires manualBalance in DSH settings");
		const current = this.manualLedger;
		if (current !== void 0 && current.version === 1 && current.initialBalance === this.manualBalance && current.currency === this.manualCurrency) return current;
		const sessionsStore = this.ctx.get("sessions");
		const checkpoints = {};
		for (const session of sessionsStore?.list() ?? []) checkpoints[String(session.id)] = this.sessionUsage(session);
		const ledger = createManualLedger(this.manualBalance, this.manualCurrency, Date.now(), checkpoints);
		await this.commitManualLedger(ledger);
		return ledger;
	}
	/** Persist before publishing in memory; failure leaves the previous ledger intact. */
	async commitManualLedger(ledger) {
		const persist = this.persistManualLedger;
		if (persist === void 0) throw new Error("manual mode requires a writable DSH settings provider");
		await persist(ledger);
		this.manualLedger = ledger;
		this.cached = void 0;
	}
	/** Local remaining balance, optionally advanced for one current session. */
	async manualView(session) {
		try {
			return await this.withManualLock(async () => {
				let ledger = await this.ensureManualLedger();
				if (session !== void 0) {
					const { pricingKey } = this.resolveModelForSession(session);
					const next = advanceManualLedger(ledger, String(session.id), session.header.createdAt, this.sessionUsage(session), this.effectiveCostConfig(pricingKey));
					if (next !== ledger) {
						await this.commitManualLedger(next);
						ledger = next;
					}
				}
				return manualLedgerView(ledger);
			});
		} catch (error) {
			return {
				fetchedAt: Date.now(),
				source: "manual",
				available: false,
				balances: [],
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	/** Build the configured balance endpoint without leaking the credential. */
	balanceUrl() {
		if (this.source === "official") return `${DEFAULT_BASE_URL}/user/balance`;
		const endpoint = this.balanceEndpoint?.trim();
		if (endpoint !== void 0 && endpoint !== "") {
			if (/^https?:\/\//i.test(endpoint)) return parseBaseUrl(endpoint).origin + parseBaseUrl(endpoint).prefix;
			const { origin, prefix } = parseBaseUrl(this.baseUrl);
			return `${origin}${prefix}/${endpoint.replace(/^\/+/, "")}`;
		}
		const { origin, prefix } = parseBaseUrl(this.baseUrl);
		return `${origin}${prefix}/user/balance`;
	}
	async query() {
		const source = this.source === "manual" ? "proxy" : this.source;
		const key = await this.resolveApiKey();
		const fetchedAt = Date.now();
		if (key === void 0) return {
			fetchedAt,
			source,
			available: false,
			balances: [],
			error: `no API key (store ${this.apiKeyEnv} via the credentials seam, or export it in the environment)`
		};
		try {
			const url = this.balanceUrl();
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
			if (!response.ok) return {
				fetchedAt,
				source,
				available: false,
				balances: [],
				error: `${source} balance request failed: HTTP ${response.status}`
			};
			return parseProviderBalance(await response.json(), source, {
				balancePath: this.proxyBalancePath,
				currency: this.proxyCurrency,
				fetchedAt
			});
		} catch (error) {
			return {
				fetchedAt,
				source,
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
//#endregion
export { PRO_COST_CONFIG as _, DEFAULT_REFRESH_INTERVAL_SECONDS as a, resolveCostConfig as b, manualLedgerView as c, validateBalanceConfig as d, PRICING_URL as f, FLASH_COST_CONFIG as g, DEFAULT_COST_CONFIG as h, DEFAULT_CURRENCY as i, parseProviderBalance as l, isPeakHour as m, DEFAULT_API_KEY_ENV as n, advanceManualLedger as o, fetchPricing as p, DEFAULT_BASE_URL as r, createManualLedger as s, BalanceService as t, resolveBalanceSource as u, costOfTokens as v, costOfUsage as y };
