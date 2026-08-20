import { _ as PRO_COST_CONFIG, a as DEFAULT_REFRESH_INTERVAL_SECONDS, b as resolveCostConfig, c as manualLedgerView, d as validateBalanceConfig, f as PRICING_URL, g as FLASH_COST_CONFIG, h as DEFAULT_COST_CONFIG, i as DEFAULT_CURRENCY, l as parseProviderBalance, m as isPeakHour, n as DEFAULT_API_KEY_ENV, o as advanceManualLedger, p as fetchPricing, r as DEFAULT_BASE_URL, s as createManualLedger, t as BalanceService, u as resolveBalanceSource, v as costOfTokens, y as costOfUsage } from "./service-0HLcoHHI.js";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
//#region src/routes.ts
/** Browser-facing base path of the balance API. */
const BALANCE_API_PREFIX = "/api/balance";
/** Write one JSON response. */
function json(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}
/** Require the method or answer 405. */
function requireMethod(req, res, method) {
	if (req.method === method) return true;
	json(res, 405, {
		ok: false,
		error: "method-not-allowed"
	});
	return false;
}
/** Wrap one request-aware JSON route (e.g. the session-cost read). */
function getRequestRoute(path, run) {
	return {
		kind: "exact",
		path,
		handler: (req, res) => {
			if (!requireMethod(req, res, "GET")) return;
			Promise.resolve(run(req)).then((value) => json(res, 200, value), (error) => {
				json(res, 500, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	};
}
/** Read the `session` query parameter from the request URL. */
function sessionParam(req) {
	const raw = req.url ?? "";
	const q = raw.indexOf("?");
	if (q < 0) return void 0;
	const value = new URLSearchParams(raw.slice(q + 1)).get("session");
	return value === null || value === "" ? void 0 : value;
}
/**
* Build the full balance API route family for one service.
* @param service - the balance service.
* @param resolveSession - resolve a session id to the session (undefined when absent).
*/
function makeBalanceRoutes(service, resolveSession) {
	return [
		getRequestRoute(`${BALANCE_API_PREFIX}`, (req) => {
			const id = sessionParam(req);
			const resolved = id === void 0 ? void 0 : resolveSession(id);
			return service.view(resolved?.session);
		}),
		getRequestRoute(`${BALANCE_API_PREFIX}/refresh`, (req) => {
			const id = sessionParam(req);
			const resolved = id === void 0 ? void 0 : resolveSession(id);
			return service.refresh(resolved?.session);
		}),
		getRequestRoute(`${BALANCE_API_PREFIX}/cost`, (req) => {
			const id = sessionParam(req);
			if (id === void 0) return {
				ok: false,
				error: "missing-session"
			};
			const resolved = resolveSession(id);
			if (resolved === void 0) return {
				ok: false,
				error: "unknown-session"
			};
			return {
				ok: true,
				...resolved.cost
			};
		})
	];
}
//#endregion
//#region src/index.ts
/** Settings namespace of the balance capability. */
const BALANCE_SETTINGS_NAMESPACE = "balance";
/** Settings section schema: what the web settings surface edits. */
const USAGE_CHECKPOINT_SCHEMA = z.object({
	uncachedInputTokens: z.number().min(0),
	outputTokens: z.number().min(0),
	cacheReadTokens: z.number().min(0),
	cacheWriteTokens: z.number().min(0)
});
const MANUAL_LEDGER_SCHEMA = z.object({
	version: z.const(1),
	initialBalance: z.number().min(0),
	currency: z.string(),
	baselineAt: z.number().min(0),
	remaining: z.number(),
	spent: z.number().min(0),
	sessions: z.dict(USAGE_CHECKPOINT_SCHEMA)
}).role("secret").hidden();
const BALANCE_SETTINGS_SCHEMA = z.object({
	source: z.union([
		"official",
		"proxy",
		"manual"
	]),
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	baseUrl: z.string().default(DEFAULT_BASE_URL),
	balanceEndpoint: z.string(),
	proxyBalancePath: z.string(),
	proxyCurrency: z.string().default("CNY"),
	manualBalance: z.number().min(0),
	manualCurrency: z.string().default("CNY"),
	manualLedger: MANUAL_LEDGER_SCHEMA,
	refreshIntervalSeconds: z.number().min(0).max(3600).default(30),
	enabled: z.boolean().default(true)
});
/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
const name = "balance";
/** Services required before the balance service can answer. */
const inject = ["webServer", "sessions"];
/** Register the balance service and its API routes on the context. */
function apply(ctx, config = {}) {
	const service = new BalanceService(ctx, config);
	const namespace = settingsNamespace(BALANCE_SETTINGS_NAMESPACE);
	const base = {
		...config.source === void 0 ? {} : { source: config.source },
		apiKeyEnv: config.apiKeyEnv ?? "DEEPSEEK_API_KEY",
		baseUrl: config.baseUrl ?? "https://api.deepseek.com",
		...config.balanceEndpoint === void 0 ? {} : { balanceEndpoint: config.balanceEndpoint },
		...config.proxyBalancePath === void 0 ? {} : { proxyBalancePath: config.proxyBalancePath },
		proxyCurrency: config.proxyCurrency ?? "CNY",
		...config.manualBalance === void 0 ? {} : { manualBalance: config.manualBalance },
		manualCurrency: config.manualCurrency ?? "CNY",
		...config.manualLedger === void 0 ? {} : { manualLedger: config.manualLedger },
		refreshIntervalSeconds: config.refreshIntervalSeconds ?? 30,
		...config.model === void 0 ? {} : { model: config.model },
		...config.cost === void 0 ? {} : { cost: config.cost },
		enabled: config.enabled ?? true
	};
	let current = () => base;
	const applyConfig = (section) => {
		service.configure({
			...base,
			...section,
			model: config.model,
			cost: config.cost
		});
	};
	service.setManualLedgerPersistence(async (ledger) => {
		const settings = ctx.get("settings");
		if (settings === void 0 || !settings.writable) throw new Error("manual mode requires a writable DSH settings provider");
		await settings.mutate(namespace, [{
			op: "set",
			path: ["manualLedger"],
			value: ledger
		}]);
	});
	const resolveSession = (id) => {
		const session = ctx.get("sessions")?.get(id);
		if (session === void 0) return void 0;
		return {
			session,
			cost: service.sessionCost(session)
		};
	};
	const routes = makeBalanceRoutes(service, resolveSession);
	let disposeRoutes;
	const syncRoutes = () => {
		const enabled = current().enabled ?? true;
		if (disposeRoutes === void 0 && enabled) disposeRoutes = ctx.effect(() => {
			const disposers = routes.map((route) => ctx.webServer.register(route));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "balance: routes");
		else if (disposeRoutes !== void 0 && !enabled) {
			disposeRoutes();
			disposeRoutes = void 0;
		}
	};
	installSettingsSection(ctx, namespace, BALANCE_SETTINGS_SCHEMA, base, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {
			applyConfig(current());
			syncRoutes();
		},
		validate: validateBalanceConfig
	});
	ctx.on("session/created", (session) => {
		service.checkpointSession(session).catch(() => void 0);
	});
	syncRoutes();
}
//#endregion
export { BALANCE_API_PREFIX, BALANCE_SETTINGS_NAMESPACE, BALANCE_SETTINGS_SCHEMA, BalanceService, DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_COST_CONFIG, DEFAULT_CURRENCY, DEFAULT_REFRESH_INTERVAL_SECONDS, FLASH_COST_CONFIG, PRICING_URL, PRO_COST_CONFIG, advanceManualLedger, apply, costOfTokens, costOfUsage, createManualLedger, fetchPricing, inject, isPeakHour, makeBalanceRoutes, manualLedgerView, name, parseProviderBalance, resolveBalanceSource, resolveCostConfig, validateBalanceConfig };
