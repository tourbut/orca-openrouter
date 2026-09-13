import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SECRET_KEY } from '../src/shared/types.ts'
import { UsageService } from '../src/worker/service.ts'
import { createMemoryStore } from '../src/worker/store.ts'
import { jsonResponse, rawItem } from './helpers.ts'

test('a later save of the same key is not deleted by an older remove', async () => {
  const store = createMemoryStore()
  let resolveSave!: (value: Response) => void
  const saveGate = new Promise<Response>((res) => {
    resolveSave = res
  })
  let fetches = 0
  const service = new UsageService({
    store,
    now: () => new Date('2026-09-12T12:00:00.000Z'),
    fetchImpl: async () => {
      fetches += 1
      if (fetches === 1) return saveGate
      return jsonResponse(200, { data: [rawItem({ date: '2026-09-11', byok_usage_inference: 0 })] })
    }
  })
  const firstSave = service.saveConnection({ apiKey: 'sk-or-v1-live' })
  const removed = service.removeConnection()
  const secondSave = service.saveConnection({ apiKey: 'sk-or-v1-live' })
  resolveSave(jsonResponse(200, { data: [rawItem({ date: '2026-09-11', byok_usage_inference: 0 })] }))
  await firstSave
  await removed
  const saved = await secondSave
  assert.equal(saved.ok, true)
  assert.equal(await store.secretsGet(SECRET_KEY), 'sk-or-v1-live')
})
