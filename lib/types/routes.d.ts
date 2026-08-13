/**
 * dsh-balance-meter HTTP routes — the browser half talks to the host through plain
 * same-origin JSON endpoints (`/api/balance` and `/api/balance/cost`), which
 * the host answers by querying the DeepSeek Get User Balance endpoint and the
 * session token-usage projection. The client never sees the API key.
 * @module dsh-balance-meter/routes
 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import type { BalanceService, SessionCost } from './service.ts';
/** Browser-facing base path of the balance API. */
export declare const BALANCE_API_PREFIX = "/api/balance";
/**
 * Build the full balance API route family for one service.
 * @param service - the balance service.
 * @param resolveSession - resolve a session id to the session (undefined when absent).
 */
export declare function makeBalanceRoutes(service: BalanceService, resolveSession: (id: string) => {
    session: unknown;
    cost: SessionCost;
} | undefined): WebRoute[];
//# sourceMappingURL=routes.d.ts.map