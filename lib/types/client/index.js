/**
 * dsh-balance-meter browser half — registers the DeepSeek account balance chip into
 * the composer dock band (`conversation.composer.dock`, the same seat the
 * official conversation stats line uses) and reads the host's same-origin
 * `/api/balance` JSON endpoints: poll the host snapshot (~30 s), refresh on
 * demand. The chip shows the account total balance and availability; while
 * the host reports no usable balance (disabled, missing key, or provider
 * error) it renders a compact unavailable state with a manual refresh action.
 * @module dsh-balance-meter/client
 */
import { BalanceDockEntry } from "./BalanceDockEntry.js";
import { en, zh } from "./locales.js";
export { BalanceDockEntry } from "./BalanceDockEntry.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'balance';
/** Required services: slots for the composer-dock entry, locale for the copy. */
export const inject = ['slots', 'locale', 'connection'];
/**
 * Register the balance chip into the composer dock band.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-balance-meter: dictionaries');
    ctx.inject(['slots', 'conversation'], (scope) => {
        scope.effect(() => scope.slots.register({
            name: 'conversation.composer.dock',
            id: 'balance',
            order: 120,
            locale: NS,
            inject: () => ({}),
        }, BalanceDockEntry), 'dsh-balance-meter: chip registration');
    });
}
