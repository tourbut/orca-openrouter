import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateActivity } from '../src/worker/aggregate.ts'
import { frozenNow, item } from './helpers.ts'

test('aggregates by day, model version, and provider without double-counting BYOK or reasoning', () => {
  const now = frozenNow()
  const snapshot = aggregateActivity(
    [
      item({
        date: '2026-09-11',
        usage: 0.02,
        byokUsageInference: 0.01,
        requests: 2,
        promptTokens: 10,
        completionTokens: 20,
        reasoningTokens: 5
      }),
      item({
        date: '2026-09-11',
        providerName: 'Azure',
        endpointId: 'endpoint-azure',
        usage: 0.03,
        byokUsageInference: 0,
        requests: 1,
        promptTokens: 5,
        completionTokens: 7,
        reasoningTokens: 1
      }),
      item({
        date: '2026-09-10',
        model: 'anthropic/claude-sonnet-4',
        modelPermaslug: 'anthropic/claude-sonnet-4-20250514',
        usage: 1.5,
        byokUsageInference: 0,
        requests: 4,
        promptTokens: 100,
        completionTokens: 50,
        reasoningTokens: 0
      }),
      item({
        date: '2026-09-12',
        usage: 99,
        requests: 99,
        promptTokens: 99,
        completionTokens: 99,
        reasoningTokens: 99
      })
    ],
    7,
    now,
    now,
    'fresh',
    false
  )

  assert.equal(snapshot.totals.usage, 1.55)
  assert.equal(snapshot.totals.byokUsageInference, 0.01)
  assert.equal(snapshot.totals.completionTokens, 77)
  assert.equal(snapshot.totals.reasoningTokens, 6)
  assert.equal(snapshot.totals.requests, 7)
  assert.equal(snapshot.daily.length, 7)
  const eleventh = snapshot.daily.find((day) => day.date === '2026-09-11')
  assert.equal(eleventh?.totals.usage, 0.05)
  const missing = snapshot.daily.find((day) => day.date === '2026-09-09')
  assert.equal(missing?.totals.usage, 0)
  assert.equal(snapshot.models[0]?.model, 'anthropic/claude-sonnet-4')
  const gpt = snapshot.models.find((model) => model.model === 'openai/gpt-4.1')
  assert.equal(gpt?.providers.length, 2)
  assert.equal(gpt?.providers[0]?.providerName, 'Azure')
  assert.ok(!snapshot.daily.some((day) => day.date === '2026-09-12'))
})

test('empty valid data is not treated as a fetch failure', () => {
  const now = frozenNow()
  const snapshot = aggregateActivity([], 7, now, now, 'fresh', false)
  assert.equal(snapshot.empty, true)
  assert.equal(snapshot.totals.usage, 0)
  assert.equal(snapshot.daily.length, 7)
})
