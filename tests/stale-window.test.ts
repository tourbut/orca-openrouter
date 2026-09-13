import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SECRET_KEY } from '../src/shared/types.ts'
import { UsageService } from '../src/worker/service.ts'
import { createMemoryStore } from '../src/worker/store.ts'
import { jsonResponse, rawItem } from './helpers.ts'

test('stale snapshots keep the fetchedAt UTC window instead of appending a new zero day', async () => {
  const store = createMemoryStore({ secrets: { [SECRET_KEY]: 'sk-or-v1-live' } })
  let now = new Date('2026-09-12T12:00:00.000Z')
  let mode: 'ok' | 'down' = 'ok'
  const service = new UsageService({
    store,
    ttlMs: 60_000,
    now: () => now,
    fetchImpl: async () => {
      if (mode === 'down') throw new Error('ECONNRESET')
      return jsonResponse(200, {
        data: [rawItem({ date: '2026-09-11', usage: 0.2, byok_usage_inference: 0 })]
      })
    }
  })
  const fresh = await service.query({ period: 7, forceRefresh: true })
  assert.equal(fresh.ok, true)
  if (fresh.ok) {
    assert.equal(fresh.value.dataEndDate, '2026-09-11')
    assert.equal(fresh.value.dataStartDate, '2026-09-05')
  }

  now = new Date('2026-09-13T01:00:00.000Z')
  mode = 'down'
  const stale = await service.query({ period: 7, forceRefresh: true })
  assert.equal(stale.ok, false)
  if (!stale.ok) {
    assert.equal(stale.snapshot?.stale, true)
    assert.equal(stale.snapshot?.dataEndDate, '2026-09-11')
    assert.equal(stale.snapshot?.dataStartDate, '2026-09-05')
    assert.ok(!stale.snapshot?.daily.some((day) => day.date === '2026-09-12'))
  }
})
