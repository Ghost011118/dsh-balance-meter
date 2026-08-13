/**
 * The composer dock entry: the DeepSeek account balance + session cost
 * readout, mounted in the composer dock band (`conversation.composer.dock`)
 * beside the official conversation stats line. The chip polls the host
 * `/api/balance` endpoint for the account total and `/api/balance/cost` for
 * the current session's estimated spend; clicking reveals the per-currency
 * balance breakdown and the cost breakdown.
 * @module dsh-balance-meter/client/BalanceDockEntry
 */

import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { BalanceView } from '../service.ts'
import { NS } from './locales.ts'
import css from './balance.module.css'

/** Session cost response (host `/api/balance/cost`). */
interface SessionCostResponse {
  ok: boolean
  error?: string
  uncachedInputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cost?: number
  currency?: string
  breakdown?: { input: number; cacheRead: number; cacheWrite: number; output: number }
}

/** The host balance API as the browser sees it (same-origin JSON endpoints). */
interface BalanceHttpApi {
  view(): Promise<BalanceView>
  refresh(): Promise<BalanceView>
  cost(sessionId: string | undefined): Promise<SessionCostResponse>
}

/** Same-origin JSON fetch helper. */
async function balanceFetch<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`balance ${path} failed: ${response.status}`)
  }
  return (await response.json()) as T
}

/** The live host API instance (failures surface per call). */
const balanceApi: BalanceHttpApi = {
  view: () => balanceFetch('/api/balance'),
  refresh: () => balanceFetch('/api/balance/refresh'),
  cost: (sessionId) => balanceFetch(
    sessionId === undefined
      ? '/api/balance/cost'
      : `/api/balance/cost?session=${encodeURIComponent(sessionId)}`,
  ),
}

/** Poll interval for the host snapshot. */
const POLL_MS = 30_000

/** Composed props of the dock entry (runtime + locale). */
export type BalanceDockEntryProps =
  PropsRuntime<'conversation.composer.dock'>
  & PropsLocale<typeof NS>

/** Format a number with up to two decimals. */
function formatAmount(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '--'
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Format an epoch-ms time as HH:MM:SS. */
function formatTime(epochMs: number): string {
  const d = new Date(epochMs)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/**
 * The account balance + session cost chip: polls the host balance snapshot
 * and the current session's cost, rendering the total balance and estimated
 * session spend. Clicking reveals the per-currency and per-bucket breakdown
 * and refreshes.
 * @param props - the composed dock entry props.
 */
export function BalanceDockEntry(props: BalanceDockEntryProps): React.ReactElement {
  const [view, setView] = useState<BalanceView | null>(null)
  const [cost, setCost] = useState<SessionCostResponse | null>(null)
  const [open, setOpen] = useState(false)
  const sessionId = props.sessionId

  const pollNow = useCallback(() => {
    let live = true
    balanceApi.view().then((snapshot) => {
      if (live) setView(snapshot)
    }, () => {
      if (live) setView(null)
    })
    balanceApi.cost(sessionId).then((snapshot) => {
      if (live) setCost(snapshot)
    }, () => {
      if (live) setCost(null)
    })
    return () => { live = false }
  }, [sessionId])

  useEffect(() => {
    const cleanup = pollNow()
    const timer = window.setInterval(pollNow, POLL_MS)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') pollNow()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cleanup()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [pollNow])

  const refresh = (): void => {
    balanceApi.refresh().then((snapshot) => {
      setView(snapshot)
    }, () => {
      // Ignore transport errors on manual refresh; the next poll resyncs.
    })
  }

  if (view === null || view.error !== undefined) {
    return (
      <button
        type="button"
        className={css.chip}
        onClick={refresh}
        title={view?.error ?? props.t('balance.error', { error: 'connection' })}
        data-testid="balance-chip-error"
      >
        <span className={css.dot} aria-hidden="true" />
        {props.t('balance.unavailable')}
      </button>
    )
  }

  const total = view.total
  const currency = view.currency ?? view.balances[0]?.currency
  const balanceLabel = total === undefined || currency === undefined
    ? props.t('balance.empty')
    : props.t('balance.total', { amount: formatAmount(total), currency })
  const costLabel = cost?.ok === true && cost.cost !== undefined
    ? props.t('balance.cost', { amount: formatAmount(cost.cost), currency: cost.currency ?? currency ?? '' })
    : undefined

  return (
    <button
      type="button"
      className={`${css.chip} ${open ? css.chipOpen : ''}`}
      onClick={() => { setOpen(o => !o) }}
      title={view.fetchedAt > 0 ? props.t('balance.fetchedAt', { time: formatTime(view.fetchedAt) }) : undefined}
      data-testid="balance-chip"
      aria-expanded={open}
    >
      <span className={view.available ? css.dotOk : css.dot} aria-hidden="true" />
      {balanceLabel}
      {costLabel !== undefined && (
        <>
          <span className={css.sep} aria-hidden="true" />
          <span className={css.cost}>{costLabel}</span>
        </>
      )}
      {open && (
        <span className={css.details} role="tooltip">
          {view.balances.map((b) => (
            <span key={b.currency} className={css.row}>
              <span>{b.currency}</span>
              <span className={css.rowRight}>
                <span title={props.t('balance.granted')}>{formatAmount(Number(b.granted_balance))}</span>
                <span>+</span>
                <span title={props.t('balance.toppedUp')}>{formatAmount(Number(b.topped_up_balance))}</span>
              </span>
            </span>
          ))}
          {cost?.ok === true && cost.cost !== undefined && (
            <span className={css.costRow}>
              <span>{props.t('balance.sessionCost')}</span>
              <span className={css.rowRight}>
                <span>{formatAmount(cost.cost)}</span>
                <span>{cost.currency ?? currency ?? ''}</span>
              </span>
            </span>
          )}
        </span>
      )}
    </button>
  )
}
