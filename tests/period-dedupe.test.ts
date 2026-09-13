import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SECRET_KEY } from '../src/shared/types.ts'
import { UsageService } from '../src/worker/service.ts'
import { createMemoryStore } from '../src/worker/store.ts'
import { jsonResponse, rawItem } from './helpers.ts'

test('7 and 30 day queries share one HTTP fetch and aggregate separately', async () => {
  const store = createMemoryStore({ secrets: { [SECRET_KEY]: 'sk-or-v1-live' } })
  let fetches = 0
  let resolve!: (value: Response) => void
  const gate = new Promise<Response>((res) => {
    resolve = res
  })
  const service = new UsageService({
    store,
    now: () => new Date('2026-09-12T12:00:00.000Z'),
    fetchImpl: async () => {
      fetches += 1
      return gate
    }
  })
  const week = service.query({ period: 7, forceRefresh: true })
  const month = service.query({ period: 30, forceRefresh: true })
  resolve(
    jsonResponse(200, {
      data: [
        rawItem({ date: '2026-09-11', usage: 0.5, byok_usage_inference: 0 }),
        rawItem({ date: '2026-08-20', usage: 2, byok_usage_inference: 0, model: 'other/model', model_permaslug: 'other/model-v' })
      ]
    })
  )
  const [seven, thirty] = await Promise.all([week, month])
  assert.equal(fetches, 1)
  assert.equal(seven.ok && thirty.ok, true)
  if (seven.ok && thirty.ok) {
    assert.equal(seven.value.period, 7)
    assert.equal(thirty.value.period, 30)
    assert.equal(seven.value.totals.usage, 0.5)
    assert.equal(thirty.value.totals.usage, 2.5)
  }
})
