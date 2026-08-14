import { a as PRICING_URL, c as DEFAULT_COST_CONFIG, d as costOfTokens, f as costOfUsage, i as DEFAULT_REFRESH_INTERVAL_SECONDS, l as FLASH_COST_CONFIG, n as DEFAULT_API_KEY_ENV, o as fetchPricing, p as resolveCostConfig, r as DEFAULT_BASE_URL, s as isPeakHour, t as BalanceService, u as PRO_COST_CONFIG } from "./service-3Bkm9MkK.js";
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
/** Wrap one async balance read as a GET JSON route. */
function getRoute(path, run) {
	return {
		kind: "exact",
		path,
		handler: (req, res) => {
			if (!requireMethod(req, res, "GET")) return;
			Promise.resolve(run()).then((value) => json(res, 200, value), (error) => {
				json(res, 500, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	};
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
		getRoute(`${BALANCE_API_PREFIX}`, () => service.view()),
		getRoute(`${BALANCE_API_PREFIX}/refresh`, () => service.refresh()),
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
const BALANCE_SETTINGS_SCHEMA = z.object({
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	baseUrl: z.string().default(DEFAULT_BASE_URL),
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
	const base = {
		apiKeyEnv: config.apiKeyEnv ?? "DEEPSEEK_API_KEY",
		baseUrl: config.baseUrl ?? "https://api.deepseek.com",
		refreshIntervalSeconds: config.refreshIntervalSeconds ?? 30,
		...config.model === void 0 ? {} : { model: config.model },
		...config.cost === void 0 ? {} : { cost: config.cost },
		enabled: config.enabled ?? true
	};
	let current = () => base;
	const applyConfig = (section) => {
		service.setEnabled(section.enabled ?? true);
	};
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
	installSettingsSection(ctx, settingsNamespace(BALANCE_SETTINGS_NAMESPACE), BALANCE_SETTINGS_SCHEMA, base, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {
			applyConfig(current());
			syncRoutes();
		}
	});
	syncRoutes();
}
//#endregion
export { BALANCE_API_PREFIX, BALANCE_SETTINGS_NAMESPACE, BALANCE_SETTINGS_SCHEMA, BalanceService, DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_COST_CONFIG, DEFAULT_REFRESH_INTERVAL_SECONDS, FLASH_COST_CONFIG, PRICING_URL, PRO_COST_CONFIG, apply, costOfTokens, costOfUsage, fetchPricing, inject, isPeakHour, makeBalanceRoutes, name, resolveCostConfig };
