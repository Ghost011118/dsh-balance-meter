/**
 * dsh-balance-meter HTTP routes — the browser half talks to the host through plain
 * same-origin JSON endpoints (`/api/balance` and `/api/balance/cost`), which
 * the host answers by querying the DeepSeek Get User Balance endpoint and the
 * session token-usage projection. The client never sees the API key.
 * @module dsh-balance-meter/routes
 */
/** Browser-facing base path of the balance API. */
export const BALANCE_API_PREFIX = '/api/balance';
/** Write one JSON response. */
function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}
/** Require the method or answer 405. */
function requireMethod(req, res, method) {
    if (req.method === method)
        return true;
    json(res, 405, { ok: false, error: 'method-not-allowed' });
    return false;
}
/** Wrap one async balance read as a GET JSON route. */
function getRoute(path, run) {
    return {
        kind: 'exact',
        path,
        handler: (req, res) => {
            if (!requireMethod(req, res, 'GET'))
                return;
            Promise.resolve(run()).then((value) => json(res, 200, value), (error) => {
                json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            });
        },
    };
}
/** Wrap one request-aware JSON route (e.g. the session-cost read). */
function getRequestRoute(path, run) {
    return {
        kind: 'exact',
        path,
        handler: (req, res) => {
            if (!requireMethod(req, res, 'GET'))
                return;
            Promise.resolve(run(req)).then((value) => json(res, 200, value), (error) => {
                json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            });
        },
    };
}
/** Read the `session` query parameter from the request URL. */
function sessionParam(req) {
    const raw = req.url ?? '';
    const q = raw.indexOf('?');
    if (q < 0)
        return undefined;
    const params = new URLSearchParams(raw.slice(q + 1));
    const value = params.get('session');
    return value === null || value === '' ? undefined : value;
}
/**
 * Build the full balance API route family for one service.
 * @param service - the balance service.
 * @param resolveSession - resolve a session id to the session (undefined when absent).
 */
export function makeBalanceRoutes(service, resolveSession) {
    return [
        getRoute(`${BALANCE_API_PREFIX}`, () => service.view()),
        getRoute(`${BALANCE_API_PREFIX}/refresh`, () => service.refresh()),
        getRequestRoute(`${BALANCE_API_PREFIX}/cost`, (req) => {
            const id = sessionParam(req);
            if (id === undefined)
                return { ok: false, error: 'missing-session' };
            const resolved = resolveSession(id);
            if (resolved === undefined)
                return { ok: false, error: 'unknown-session' };
            return { ok: true, ...resolved.cost };
        }),
    ];
}
