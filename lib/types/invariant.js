/**
 * Package invariants — cheap structural checks run at import time on the
 * host side. Mirrors the pattern used by other dsh plugin packages.
 * @module dsh-balance-meter/invariant
 */
import { DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_REFRESH_INTERVAL_SECONDS, } from "./service.js";
/** Assert a condition; throws a descriptive Error when violated. */
export function invariant(condition, message) {
    if (!condition) {
        throw new Error(`[dsh-balance-meter] ${message}`);
    }
}
/** Run every package invariant once; throws on the first violation. */
export function runBalanceInvariants() {
    invariant(DEFAULT_REFRESH_INTERVAL_SECONDS >= 0, 'refresh interval must be nonnegative');
    invariant(DEFAULT_API_KEY_ENV.length > 0, 'API key env name must be non-empty');
    invariant(DEFAULT_BASE_URL.startsWith('https://') || DEFAULT_BASE_URL.startsWith('http://'), 'base URL must be http(s)');
}
// Run once on import (host half only; cheap and side-effect free).
runBalanceInvariants();
