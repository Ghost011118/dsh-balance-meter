window.__ModuleLoader__.load({
	id: "dsh-balance-meter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:D:\dsh-balance-meter\src\client\balance.module.css.mjs
		const css = ".EdMTHW_chip{border:1px solid var(--dsh-color-border,#80808059);background:var(--dsh-color-surface,transparent);height:22px;color:var(--dsh-color-text,inherit);cursor:pointer;white-space:nowrap;border-radius:999px;align-items:center;gap:6px;padding:0 8px;font-size:12px;line-height:1;display:inline-flex;position:relative}.EdMTHW_chip:hover,.EdMTHW_chipOpen{border-color:var(--dsh-color-accent,#50a0ffb3)}.EdMTHW_dot{background:var(--dsh-color-danger,#e5534b);border-radius:50%;flex:none;width:7px;height:7px}.EdMTHW_dotOk{background:var(--dsh-color-success,#2da44e);border-radius:50%;flex:none;width:7px;height:7px}.EdMTHW_details{z-index:40;border:1px solid var(--dsh-color-border,#80808059);background:var(--dsh-color-surface-elevated,#1f1f1f);min-width:140px;color:var(--dsh-color-text,inherit);border-radius:6px;flex-direction:column;gap:2px;padding:6px 8px;font-size:11px;display:flex;position:absolute;top:calc(100% + 6px);left:0;box-shadow:0 4px 12px #0000004d}.EdMTHW_row{justify-content:space-between;align-items:center;gap:12px;display:flex}.EdMTHW_rowRight{align-items:center;gap:4px;display:inline-flex}.EdMTHW_sep{opacity:.45}.EdMTHW_cost{opacity:.85}.EdMTHW_costRow{border-top:1px solid var(--dsh-color-border,#80808040);justify-content:space-between;align-items:center;gap:12px;margin-top:4px;padding-top:4px;display:flex}";
		const tagId = "dsh-balance-meter/balance.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-balance-meter";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var balance_module_css_default = {
			"chip": "EdMTHW_chip",
			"chipOpen": "EdMTHW_chipOpen",
			"cost": "EdMTHW_cost",
			"costRow": "EdMTHW_costRow",
			"details": "EdMTHW_details",
			"dot": "EdMTHW_dot",
			"dotOk": "EdMTHW_dotOk",
			"row": "EdMTHW_row",
			"rowRight": "EdMTHW_rowRight",
			"sep": "EdMTHW_sep"
		};
		//#endregion
		//#region src/client/BalanceDockEntry.tsx
		/**
		* The composer dock entry: the DeepSeek account balance + session cost
		* readout, mounted in the composer dock band (`conversation.composer.dock`)
		* beside the official conversation stats line. The chip polls the host
		* `/api/balance` endpoint for the account total and `/api/balance/cost` for
		* the current session's estimated spend; clicking reveals the per-currency
		* balance breakdown and the cost breakdown.
		* @module dsh-balance-meter/client/BalanceDockEntry
		*/
		/** Same-origin JSON fetch helper. */
		async function balanceFetch(path) {
			const response = await fetch(path);
			if (!response.ok) throw new Error(`balance ${path} failed: ${response.status}`);
			return await response.json();
		}
		/** The live host API instance (failures surface per call). */
		const balanceApi = {
			view: () => balanceFetch("/api/balance"),
			refresh: () => balanceFetch("/api/balance/refresh"),
			cost: (sessionId) => balanceFetch(sessionId === void 0 ? "/api/balance/cost" : `/api/balance/cost?session=${encodeURIComponent(sessionId)}`)
		};
		/** Poll interval for the host snapshot. */
		const POLL_MS = 3e4;
		/** Format a number with up to two decimals. */
		function formatAmount(value) {
			if (value === void 0 || Number.isNaN(value)) return "--";
			return value.toLocaleString(void 0, {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2
			});
		}
		/** Format an epoch-ms time as HH:MM:SS. */
		function formatTime(epochMs) {
			const d = new Date(epochMs);
			return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
		}
		/**
		* The account balance + session cost chip: polls the host balance snapshot
		* and the current session's cost, rendering the total balance and estimated
		* session spend. Clicking reveals the per-currency and per-bucket breakdown
		* and refreshes.
		* @param props - the composed dock entry props.
		*/
		function BalanceDockEntry(props) {
			const [view, setView] = (0, react.useState)(null);
			const [cost, setCost] = (0, react.useState)(null);
			const [open, setOpen] = (0, react.useState)(false);
			const sessionId = props.sessionId;
			const pollNow = (0, react.useCallback)(() => {
				let live = true;
				balanceApi.view().then((snapshot) => {
					if (live) setView(snapshot);
				}, () => {
					if (live) setView(null);
				});
				balanceApi.cost(sessionId).then((snapshot) => {
					if (live) setCost(snapshot);
				}, () => {
					if (live) setCost(null);
				});
				return () => {
					live = false;
				};
			}, [sessionId]);
			(0, react.useEffect)(() => {
				const cleanup = pollNow();
				const timer = window.setInterval(pollNow, POLL_MS);
				const onVisibility = () => {
					if (document.visibilityState === "visible") pollNow();
				};
				document.addEventListener("visibilitychange", onVisibility);
				return () => {
					cleanup();
					window.clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, [pollNow]);
			const refresh = () => {
				balanceApi.refresh().then((snapshot) => {
					setView(snapshot);
				}, () => {});
			};
			if (view === null || view.error !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: balance_module_css_default.chip,
				onClick: refresh,
				title: view?.error ?? props.t("balance.error", { error: "connection" }),
				"data-testid": "balance-chip-error",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: balance_module_css_default.dot,
					"aria-hidden": "true"
				}), props.t("balance.unavailable")]
			});
			const total = view.total;
			const currency = view.currency ?? view.balances[0]?.currency;
			const balanceLabel = total === void 0 || currency === void 0 ? props.t("balance.empty") : props.t("balance.total", {
				amount: formatAmount(total),
				currency
			});
			const costLabel = cost?.ok === true && cost.cost !== void 0 ? props.t("balance.cost", {
				amount: formatAmount(cost.cost),
				currency: cost.currency ?? currency ?? ""
			}) : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: `${balance_module_css_default.chip} ${open ? balance_module_css_default.chipOpen : ""}`,
				onClick: () => {
					setOpen((o) => !o);
				},
				title: view.fetchedAt > 0 ? props.t("balance.fetchedAt", { time: formatTime(view.fetchedAt) }) : void 0,
				"data-testid": "balance-chip",
				"aria-expanded": open,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: view.available ? balance_module_css_default.dotOk : balance_module_css_default.dot,
						"aria-hidden": "true"
					}),
					balanceLabel,
					costLabel !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: balance_module_css_default.sep,
						"aria-hidden": "true"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: balance_module_css_default.cost,
						children: costLabel
					})] }),
					open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: balance_module_css_default.details,
						role: "tooltip",
						children: [view.balances.map((b) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: balance_module_css_default.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: b.currency }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: balance_module_css_default.rowRight,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										title: props.t("balance.granted"),
										children: formatAmount(Number(b.granted_balance))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "+" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										title: props.t("balance.toppedUp"),
										children: formatAmount(Number(b.topped_up_balance))
									})
								]
							})]
						}, b.currency)), cost?.ok === true && cost.cost !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: balance_module_css_default.costRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: props.t("balance.sessionCost") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: balance_module_css_default.rowRight,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatAmount(cost.cost) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: cost.currency ?? currency ?? "" })]
							})]
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Chinese copy. */
		const zh = {
			"balance.total": "余额 {amount} {currency}",
			"balance.cost": "本场 {amount} {currency}",
			"balance.sessionCost": "本场消耗",
			"balance.available": "可用",
			"balance.unavailable": "不可用",
			"balance.error": "查询失败：{error}",
			"balance.loading": "查询中…",
			"balance.empty": "暂无余额数据",
			"balance.refresh": "刷新",
			"balance.fetchedAt": "更新于 {time}",
			"balance.granted": "赠送",
			"balance.toppedUp": "充值",
			"settings.title": "余额",
			"settings.description": "显示 DeepSeek 账户余额与可用状态。",
			"settings.enabled": "启用余额显示",
			"settings.enabledHint": "关闭后隐藏余额并停止轮询。",
			"settings.apiKeyEnv": "API Key 环境变量名",
			"settings.apiKeyEnvHint": "存储 DeepSeek API Key 的凭据引用（默认 DEEPSEEK_API_KEY）。",
			"settings.baseUrl": "API 地址",
			"settings.baseUrlHint": "DeepSeek API 基础地址，一般保持默认。",
			"settings.refreshInterval": "刷新间隔（秒）",
			"settings.refreshIntervalHint": "两次向官方余额接口查询的最小间隔。",
			"settings.inherit": "继承",
			"settings.on": "开",
			"settings.off": "关",
			"settings.overridden": "已覆盖",
			"settings.reset": "恢复默认",
			"settings.readOnly": "当前部署的设置只读。",
			"settings.expand": "展开设置",
			"settings.collapse": "收起设置",
			"settings.save": "保存",
			"settings.saving": "保存中…",
			"settings.discard": "放弃",
			"settings.unsaved": "未保存",
			"settings.saveFailed": "部署未接受这些值，已保留供你修改。",
			"settings.invalidNumber": "请输入数字，留空则使用默认值。"
		};
		/** English copy. */
		const en = {
			"balance.total": "Balance {amount} {currency}",
			"balance.cost": "This session {amount} {currency}",
			"balance.sessionCost": "This session",
			"balance.available": "available",
			"balance.unavailable": "unavailable",
			"balance.error": "Query failed: {error}",
			"balance.loading": "Loading…",
			"balance.empty": "No balance data yet",
			"balance.refresh": "Refresh",
			"balance.fetchedAt": "Updated {time}",
			"balance.granted": "granted",
			"balance.toppedUp": "top-up",
			"settings.title": "Balance",
			"settings.description": "Show the DeepSeek account balance and availability.",
			"settings.enabled": "Enable the balance readout",
			"settings.enabledHint": "When off, the readout hides and polling stops.",
			"settings.apiKeyEnv": "API key env name",
			"settings.apiKeyEnvHint": "The credential reference storing the DeepSeek API key (default DEEPSEEK_API_KEY).",
			"settings.baseUrl": "API base URL",
			"settings.baseUrlHint": "DeepSeek API base URL; keep the default normally.",
			"settings.refreshInterval": "Refresh interval (s)",
			"settings.refreshIntervalHint": "Minimum seconds between official balance queries.",
			"settings.inherit": "Inherit",
			"settings.on": "On",
			"settings.off": "Off",
			"settings.overridden": "Overridden",
			"settings.reset": "Reset to default",
			"settings.readOnly": "This deployment stores settings read-only.",
			"settings.expand": "Show settings",
			"settings.collapse": "Hide settings",
			"settings.save": "Save",
			"settings.saving": "Saving…",
			"settings.discard": "Discard",
			"settings.unsaved": "Unsaved",
			"settings.saveFailed": "The deployment did not accept these values; they were left for you to correct.",
			"settings.invalidNumber": "Enter a number, or leave blank to use the default."
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "balance";
		/** Required services: slots for the composer-dock entry, locale for the copy. */
		const inject = [
			"slots",
			"locale",
			"connection"
		];
		/**
		* Register the balance chip into the composer dock band.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-balance-meter: dictionaries");
			ctx.inject(["slots", "conversation"], (scope) => {
				scope.effect(() => scope.slots.register({
					name: "conversation.composer.dock",
					id: "balance",
					order: 120,
					locale: NS,
					inject: () => ({})
				}, BalanceDockEntry), "dsh-balance-meter: chip registration");
			});
		}
		//#endregion
		exports.BalanceDockEntry = BalanceDockEntry;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map