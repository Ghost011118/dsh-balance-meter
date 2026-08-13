/**
 * dsh-balance-meter locale dictionaries (zh/en).
 * @module dsh-balance-meter/client/locales
 */
/** Dictionary namespace this package registers. */
export declare const NS = "balance";
/** Chinese copy. */
export declare const zh: {
    readonly 'balance.total': "余额 {amount} {currency}";
    readonly 'balance.cost': "本场 {amount} {currency}";
    readonly 'balance.sessionCost': "本场消耗";
    readonly 'balance.available': "可用";
    readonly 'balance.unavailable': "不可用";
    readonly 'balance.error': "查询失败：{error}";
    readonly 'balance.loading': "查询中…";
    readonly 'balance.empty': "暂无余额数据";
    readonly 'balance.refresh': "刷新";
    readonly 'balance.fetchedAt': "更新于 {time}";
    readonly 'balance.granted': "赠送";
    readonly 'balance.toppedUp': "充值";
    readonly 'settings.title': "余额";
    readonly 'settings.description': "显示 DeepSeek 账户余额与可用状态。";
    readonly 'settings.enabled': "启用余额显示";
    readonly 'settings.enabledHint': "关闭后隐藏余额并停止轮询。";
    readonly 'settings.apiKeyEnv': "API Key 环境变量名";
    readonly 'settings.apiKeyEnvHint': "存储 DeepSeek API Key 的凭据引用（默认 DEEPSEEK_API_KEY）。";
    readonly 'settings.baseUrl': "API 地址";
    readonly 'settings.baseUrlHint': "DeepSeek API 基础地址，一般保持默认。";
    readonly 'settings.refreshInterval': "刷新间隔（秒）";
    readonly 'settings.refreshIntervalHint': "两次向官方余额接口查询的最小间隔。";
    readonly 'settings.inherit': "继承";
    readonly 'settings.on': "开";
    readonly 'settings.off': "关";
    readonly 'settings.overridden': "已覆盖";
    readonly 'settings.reset': "恢复默认";
    readonly 'settings.readOnly': "当前部署的设置只读。";
    readonly 'settings.expand': "展开设置";
    readonly 'settings.collapse': "收起设置";
    readonly 'settings.save': "保存";
    readonly 'settings.saving': "保存中…";
    readonly 'settings.discard': "放弃";
    readonly 'settings.unsaved': "未保存";
    readonly 'settings.saveFailed': "部署未接受这些值，已保留供你修改。";
    readonly 'settings.invalidNumber': "请输入数字，留空则使用默认值。";
};
/** English copy. */
export declare const en: {
    readonly 'balance.total': "Balance {amount} {currency}";
    readonly 'balance.cost': "This session {amount} {currency}";
    readonly 'balance.sessionCost': "This session";
    readonly 'balance.available': "available";
    readonly 'balance.unavailable': "unavailable";
    readonly 'balance.error': "Query failed: {error}";
    readonly 'balance.loading': "Loading…";
    readonly 'balance.empty': "No balance data yet";
    readonly 'balance.refresh': "Refresh";
    readonly 'balance.fetchedAt': "Updated {time}";
    readonly 'balance.granted': "granted";
    readonly 'balance.toppedUp': "top-up";
    readonly 'settings.title': "Balance";
    readonly 'settings.description': "Show the DeepSeek account balance and availability.";
    readonly 'settings.enabled': "Enable the balance readout";
    readonly 'settings.enabledHint': "When off, the readout hides and polling stops.";
    readonly 'settings.apiKeyEnv': "API key env name";
    readonly 'settings.apiKeyEnvHint': "The credential reference storing the DeepSeek API key (default DEEPSEEK_API_KEY).";
    readonly 'settings.baseUrl': "API base URL";
    readonly 'settings.baseUrlHint': "DeepSeek API base URL; keep the default normally.";
    readonly 'settings.refreshInterval': "Refresh interval (s)";
    readonly 'settings.refreshIntervalHint': "Minimum seconds between official balance queries.";
    readonly 'settings.inherit': "Inherit";
    readonly 'settings.on': "On";
    readonly 'settings.off': "Off";
    readonly 'settings.overridden': "Overridden";
    readonly 'settings.reset': "Reset to default";
    readonly 'settings.readOnly': "This deployment stores settings read-only.";
    readonly 'settings.expand': "Show settings";
    readonly 'settings.collapse': "Hide settings";
    readonly 'settings.save': "Save";
    readonly 'settings.saving': "Saving…";
    readonly 'settings.discard': "Discard";
    readonly 'settings.unsaved': "Unsaved";
    readonly 'settings.saveFailed': "The deployment did not accept these values; they were left for you to correct.";
    readonly 'settings.invalidNumber': "Enter a number, or leave blank to use the default.";
};
/** Key union for this namespace. */
export type BalanceKey = keyof typeof zh;
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** dsh-balance-meter UI copy. */
        balance: BalanceKey;
    }
}
//# sourceMappingURL=locales.d.ts.map