import { describe, expect, it } from 'vitest'
import { redactSecrets } from '@deepseek-ai/dsh-settings'
import { resolveCostConfig } from './cost.ts'
import { BALANCE_SETTINGS_SCHEMA } from './index.ts'
import {
  advanceManualLedger,
  createManualLedger,
  manualLedgerView,
  parseProviderBalance,
  resolveBalanceSource,
  type UsageCheckpoint,
} from './service.ts'

const zeroUsage: UsageCheckpoint = {
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

const oneCnyPerMillion = resolveCostConfig({
  inputPerMillion: 1,
  cacheReadPerMillion: 0,
  cacheWritePerMillion: 0,
  outputPerMillion: 0,
  currency: 'CNY',
})

describe('balance source contracts', () => {
  it('preserves official responses with an explicit official source', () => {
    const view = parseProviderBalance({
      is_available: true,
      balance_infos: [{
        currency: 'CNY',
        total_balance: '12.5',
        granted_balance: '2.5',
        topped_up_balance: '10',
      }],
    }, 'official', { fetchedAt: 123 })

    expect(view).toMatchObject({ source: 'official', total: 12.5, currency: 'CNY', fetchedAt: 123 })
  })

  it('labels a DeepSeek-compatible relay as proxy, never official', () => {
    const view = parseProviderBalance({
      is_available: true,
      balance_infos: [{ currency: 'USD', total_balance: '4', granted_balance: '0', topped_up_balance: '4' }],
    }, 'proxy')

    expect(view.source).toBe('proxy')
    expect(view.total).toBe(4)
  })

  it('reads an explicitly mapped generic proxy balance', () => {
    const view = parseProviderBalance({ data: { balance: '7.25' } }, 'proxy', {
      balancePath: 'data.balance',
      currency: 'usd',
    })

    expect(view).toMatchObject({ source: 'proxy', total: 7.25, currency: 'USD' })
  })

  it('fails clearly for unknown, missing, or non-numeric proxy data', () => {
    expect(() => parseProviderBalance({ data: {} }, 'proxy')).toThrow('configure proxyBalancePath')
    expect(() => parseProviderBalance({ data: {} }, 'proxy', { balancePath: 'data.balance' }))
      .toThrow('was not found')
    expect(() => parseProviderBalance({ data: { balance: 'many' } }, 'proxy', { balancePath: 'data.balance' }))
      .toThrow('is not numeric')
  })

  it('classifies legacy custom base URLs as proxy', () => {
    expect(resolveBalanceSource({ baseUrl: 'https://relay.example/v1' })).toBe('proxy')
    expect(resolveBalanceSource({})).toBe('official')
  })
})

describe('manual ledger restart invariants', () => {
  it('accepts a zero baseline and rejects invalid negative input', () => {
    expect(createManualLedger(0, 'cny', 100)).toMatchObject({ remaining: 0, currency: 'CNY' })
    expect(() => createManualLedger(-1, 'CNY', 100)).toThrow('non-negative')
  })

  it('charges a cumulative session only once across repeated polls and JSON restart', () => {
    const baseline = createManualLedger(10, 'CNY', 100)
    const usage = { ...zeroUsage, uncachedInputTokens: 1_000_000 }
    const once = advanceManualLedger(baseline, 'new-session', 101, usage, oneCnyPerMillion)
    const repeated = advanceManualLedger(once, 'new-session', 101, usage, oneCnyPerMillion)
    const restored = JSON.parse(JSON.stringify(repeated)) as typeof repeated
    const afterRestart = advanceManualLedger(restored, 'new-session', 101, usage, oneCnyPerMillion)

    expect(once.remaining).toBe(9)
    expect(repeated.remaining).toBe(9)
    expect(afterRestart.remaining).toBe(9)
    expect(afterRestart.spent).toBe(1)
  })

  it('keeps checkpoints monotonic when token usage temporarily disappears', () => {
    const baseline = createManualLedger(10, 'CNY', 100)
    const oneMillion = { ...zeroUsage, uncachedInputTokens: 1_000_000 }
    const charged = advanceManualLedger(baseline, 'session', 101, oneMillion, oneCnyPerMillion)
    const temporarilyMissing = advanceManualLedger(charged, 'session', 101, zeroUsage, oneCnyPerMillion)
    const recovered = advanceManualLedger(temporarilyMissing, 'session', 101, oneMillion, oneCnyPerMillion)

    expect(charged.remaining).toBe(9)
    expect(temporarilyMissing.remaining).toBe(9)
    expect(temporarilyMissing.sessions.session?.uncachedInputTokens).toBe(1_000_000)
    expect(recovered.remaining).toBe(9)
    expect(recovered.spent).toBe(1)
  })

  it('checkpoints a pre-baseline restored session without retroactive charging', () => {
    const baseline = createManualLedger(10, 'CNY', 200)
    const oldUsage = { ...zeroUsage, uncachedInputTokens: 3_000_000 }
    const checkpointed = advanceManualLedger(baseline, 'old-session', 100, oldUsage, oneCnyPerMillion)
    const later = advanceManualLedger(
      checkpointed,
      'old-session',
      100,
      { ...oldUsage, uncachedInputTokens: 4_000_000 },
      oneCnyPerMillion,
    )

    expect(checkpointed.remaining).toBe(10)
    expect(later.remaining).toBe(9)
  })

  it('exposes only a derived summary, never session checkpoints', () => {
    const ledger = createManualLedger(10, 'CNY', 200, { secretSessionId: zeroUsage })
    const view = manualLedgerView(ledger, 201)

    expect(view).toMatchObject({ source: 'manual', total: 10, baselineAt: 200, fetchedAt: 201 })
    expect(view).not.toHaveProperty('sessions')
    expect(view).not.toHaveProperty('manualLedger')
    expect(JSON.stringify(view)).not.toContain('secretSessionId')
  })

  it('keeps the persisted ledger parseable but hidden from settings renderers', () => {
    const ledger = createManualLedger(10, 'CNY', 200, { session: zeroUsage })
    const parsed = BALANCE_SETTINGS_SCHEMA({ manualBalance: 10, manualLedger: ledger }) as {
      manualLedger?: typeof ledger
    }
    const serialized = BALANCE_SETTINGS_SCHEMA.toJSON() as unknown as {
      uid: number
      refs: Record<string, { dict?: Record<string, number>; meta?: { hidden?: boolean; role?: string } }>
    }
    const root = serialized.refs[String(serialized.uid)]
    const ledgerRef = root?.dict?.manualLedger

    expect(parsed.manualLedger).toEqual(ledger)
    expect(ledgerRef).toBeDefined()
    expect(serialized.refs[String(ledgerRef)]?.meta?.hidden).toBe(true)
    expect(serialized.refs[String(ledgerRef)]?.meta).toMatchObject({ role: 'secret' })
  })

  it('removes the entire ledger from settings wire values', () => {
    const ledger = createManualLedger(10, 'CNY', 200, {
      secretSessionId: { ...zeroUsage, uncachedInputTokens: 123_456 },
    })
    const wire = redactSecrets(BALANCE_SETTINGS_SCHEMA, {
      source: 'manual',
      manualBalance: 10,
      manualLedger: ledger,
    })
    const encoded = JSON.stringify(wire)

    expect(wire.value).toEqual({ source: 'manual', manualBalance: 10 })
    expect(wire.secrets).toEqual([{ path: ['manualLedger'], set: true }])
    expect(encoded).not.toContain('secretSessionId')
    expect(encoded).not.toContain('uncachedInputTokens')
    expect(encoded).not.toContain('123456')
  })
})
