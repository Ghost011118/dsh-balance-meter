import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The composer dock entry: the DeepSeek account balance + session cost
 * readout, mounted in the composer dock band (`conversation.composer.dock`)
 * beside the official conversation stats line. The chip polls the host
 * `/api/balance` endpoint for the account total and `/api/balance/cost` for
 * the current session's estimated spend; clicking reveals the per-currency
 * balance breakdown and the cost breakdown.
 * @module dsh-balance-meter/client/BalanceDockEntry
 */
import { useCallback, useEffect, useState } from 'react';
import css from './balance.module.css';
/** Same-origin JSON fetch helper. */
async function balanceFetch(path) {
    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`balance ${path} failed: ${response.status}`);
    }
    return (await response.json());
}
/** The live host API instance (failures surface per call). */
const balanceApi = {
    view: () => balanceFetch('/api/balance'),
    refresh: () => balanceFetch('/api/balance/refresh'),
    cost: (sessionId) => balanceFetch(sessionId === undefined
        ? '/api/balance/cost'
        : `/api/balance/cost?session=${encodeURIComponent(sessionId)}`),
};
/** Poll interval for the host snapshot. */
const POLL_MS = 30_000;
/** Format a number with up to two decimals. */
function formatAmount(value) {
    if (value === undefined || Number.isNaN(value))
        return '--';
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** Format an epoch-ms time as HH:MM:SS. */
function formatTime(epochMs) {
    const d = new Date(epochMs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}
/**
 * The account balance + session cost chip: polls the host balance snapshot
 * and the current session's cost, rendering the total balance and estimated
 * session spend. Clicking reveals the per-currency and per-bucket breakdown
 * and refreshes.
 * @param props - the composed dock entry props.
 */
export function BalanceDockEntry(props) {
    const [view, setView] = useState(null);
    const [cost, setCost] = useState(null);
    const [open, setOpen] = useState(false);
    const sessionId = props.sessionId;
    const pollNow = useCallback(() => {
        let live = true;
        balanceApi.view().then((snapshot) => {
            if (live)
                setView(snapshot);
        }, () => {
            if (live)
                setView(null);
        });
        balanceApi.cost(sessionId).then((snapshot) => {
            if (live)
                setCost(snapshot);
        }, () => {
            if (live)
                setCost(null);
        });
        return () => { live = false; };
    }, [sessionId]);
    useEffect(() => {
        const cleanup = pollNow();
        const timer = window.setInterval(pollNow, POLL_MS);
        const onVisibility = () => {
            if (document.visibilityState === 'visible')
                pollNow();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            cleanup();
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [pollNow]);
    const refresh = () => {
        balanceApi.refresh().then((snapshot) => {
            setView(snapshot);
        }, () => {
            // Ignore transport errors on manual refresh; the next poll resyncs.
        });
    };
    if (view === null || view.error !== undefined) {
        return (_jsxs("button", { type: "button", className: css.chip, onClick: refresh, title: view?.error ?? props.t('balance.error', { error: 'connection' }), "data-testid": "balance-chip-error", children: [_jsx("span", { className: css.dot, "aria-hidden": "true" }), props.t('balance.unavailable')] }));
    }
    const total = view.total;
    const currency = view.currency ?? view.balances[0]?.currency;
    const balanceLabel = total === undefined || currency === undefined
        ? props.t('balance.empty')
        : props.t('balance.total', { amount: formatAmount(total), currency });
    const costLabel = cost?.ok === true && cost.cost !== undefined
        ? props.t('balance.cost', { amount: formatAmount(cost.cost), currency: cost.currency ?? currency ?? '' })
        : undefined;
    return (_jsxs("button", { type: "button", className: `${css.chip} ${open ? css.chipOpen : ''}`, onClick: () => { setOpen(o => !o); }, title: view.fetchedAt > 0 ? props.t('balance.fetchedAt', { time: formatTime(view.fetchedAt) }) : undefined, "data-testid": "balance-chip", "aria-expanded": open, children: [_jsx("span", { className: view.available ? css.dotOk : css.dot, "aria-hidden": "true" }), balanceLabel, costLabel !== undefined && (_jsxs(_Fragment, { children: [_jsx("span", { className: css.sep, "aria-hidden": "true" }), _jsx("span", { className: css.cost, children: costLabel })] })), open && (_jsxs("span", { className: css.details, role: "tooltip", children: [view.balances.map((b) => (_jsxs("span", { className: css.row, children: [_jsx("span", { children: b.currency }), _jsxs("span", { className: css.rowRight, children: [_jsx("span", { title: props.t('balance.granted'), children: formatAmount(Number(b.granted_balance)) }), _jsx("span", { children: "+" }), _jsx("span", { title: props.t('balance.toppedUp'), children: formatAmount(Number(b.topped_up_balance)) })] })] }, b.currency))), cost?.ok === true && cost.cost !== undefined && (_jsxs("span", { className: css.costRow, children: [_jsx("span", { children: props.t('balance.sessionCost') }), _jsxs("span", { className: css.rowRight, children: [_jsx("span", { children: formatAmount(cost.cost) }), _jsx("span", { children: cost.currency ?? currency ?? '' })] })] }))] }))] }));
}
