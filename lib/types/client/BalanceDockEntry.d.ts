/**
 * The composer dock entry: the DeepSeek account balance + session cost
 * readout, mounted in the composer dock band (`conversation.composer.dock`)
 * beside the official conversation stats line. The chip polls the host
 * `/api/balance` endpoint for the account total and `/api/balance/cost` for
 * the current session's estimated spend; clicking reveals the per-currency
 * balance breakdown and the cost breakdown.
 * @module dsh-balance-meter/client/BalanceDockEntry
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { NS } from './locales.ts';
/** Composed props of the dock entry (runtime + locale). */
export type BalanceDockEntryProps = PropsRuntime<'conversation.composer.dock'> & PropsLocale<typeof NS>;
/**
 * The account balance + session cost chip: polls the host balance snapshot
 * and the current session's cost, rendering the total balance and estimated
 * session spend. Clicking reveals the per-currency and per-bucket breakdown
 * and refreshes.
 * @param props - the composed dock entry props.
 */
export declare function BalanceDockEntry(props: BalanceDockEntryProps): React.ReactElement;
//# sourceMappingURL=BalanceDockEntry.d.ts.map