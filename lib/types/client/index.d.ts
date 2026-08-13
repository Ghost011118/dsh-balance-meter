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
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type BalanceKey } from './locales.ts';
export { BalanceDockEntry } from './BalanceDockEntry.tsx';
export type { BalanceDockEntryProps } from './BalanceDockEntry.tsx';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** dsh-balance-meter chip copy. */
        balance: BalanceKey;
    }
}
/** Required services: slots for the composer-dock entry, locale for the copy. */
export declare const inject: string[];
/** The injected business face (empty today: the chip calls /api/balance directly). */
export interface BalanceInjected {
}
/**
 * Register the balance chip into the composer dock band.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map