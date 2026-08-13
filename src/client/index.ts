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

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (the composer dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { BalanceDockEntry, type BalanceDockEntryProps } from './BalanceDockEntry.tsx'
import { en, zh, type BalanceKey } from './locales.ts'

export { BalanceDockEntry } from './BalanceDockEntry.tsx'
export type { BalanceDockEntryProps } from './BalanceDockEntry.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-balance-meter chip copy. */
    balance: BalanceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'balance'

/** Required services: slots for the composer-dock entry, locale for the copy. */
export const inject = ['slots', 'locale', 'connection']

/** The injected business face (empty today: the chip calls /api/balance directly). */
export interface BalanceInjected {}

/**
 * Register the balance chip into the composer dock band.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-balance-meter: dictionaries')

  ctx.inject(['slots', 'conversation'], (scope: ClientContext) => {
    scope.effect(() => scope.slots.register({
      name: 'conversation.composer.dock',
      id: 'balance',
      order: 120,
      locale: NS,
      inject: (): BalanceInjected => ({}),
    }, BalanceDockEntry), 'dsh-balance-meter: chip registration')
  })
}
