import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatUsd } from '../src/panel/format.ts'
import { applyConnection, applyError, applySnapshot, initialPanelState } from '../src/panel/state.ts'
import { ZERO_TOTALS, type UsageSnapshot } from '../src/shared/types.ts'

const snapshot = (overrides: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  period: 7,
  fetchedAt: '2026-09-12T12:00:00.000Z',
  dataStartDate: '2026-09-05',
  dataEndDate: '2026-09-11',
  stale: false,
  cache: 'fresh',
  totals: ZERO_TOTALS,
  daily: [],
  models: [],
  modelsTruncated: false,
  empty: true,
  ...overrides
})

test('connection status opens settings when no key is stored', () => {
  const next = applyConnection(initialPanelState(), { connected: false })
  assert.equal(next.view.kind, 'needs_key')
  assert.equal(next.settingsOpen, true)
})

test('errors keep a stale snapshot and not-connected is distinct from fetch failure', () => {
  const withData = applySnapshot(initialPanelState(), snapshot({ empty: false }))
  const stale = applyError(
    withData,
    { code: 'network', message: 'offline', retryable: true },
    snapshot({ stale: true, cache: 'stale' })
  )
  assert.equal(stale.view.kind, 'error')
  if (stale.view.kind === 'error') assert.equal(stale.view.snapshot?.stale, true)

  const missing = applyError(initialPanelState(), {
    code: 'not_connected',
    message: 'No management key is stored.',
    retryable: false
  })
  assert.equal(missing.view.kind, 'needs_key')
})

test('cost display keeps at least four decimal places', () => {
  assert.equal(formatUsd(0.015), '$0.0150')
  assert.equal(formatUsd(0.000012), '$0.000012')
})
