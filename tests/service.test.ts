import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SECRET_KEY } from '../src/shared/types.ts'
import { UsageService } from '../src/worker/service.ts'
import { createMemoryStore } from '../src/worker/store.ts'
import { jsonResponse, rawItem } from './helpers.ts'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

test('save verifies the key, keeps the previous secret on failure, and never logs the secret', async () => {
  const store = createMemoryStore({ secrets: { [SECRET_KEY]: 'sk-or-v1-oldkey' } })
  const service = new UsageService({
    store,
    now: () => new Date('2026-09-12T12:00:00.000Z'),
    fetchImpl: async () => jsonResponse(403, { error: { message: 'Only management keys' } })
  })
  const result = await service.saveConnection({ apiKey: 'sk-or-v1-newkey' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'forbidden')
  assert.equal(await store.secretsGet(SECRET_KEY), 'sk-or-v1-oldkey')
  assert.equal(store.logs.join(' ').includes('sk-or-v1-newkey'), false)
})

test('successful save replaces the key and discards an in-flight previous fetch', async () => {
  const store = createMemoryStore()
  const first = deferred<Response>()
  const oldStarted = deferred<void>()
  let calls = 0
  const service = new UsageService({
    store,
    now: () => new Date('2026-09-12T12:00:00.000Z'),
    fetchImpl: async (_url, init) => {
      calls += 1
      const headers = init.headers as Record<string, string>
      const header = headers.authorization ?? ''
      if (header.endsWith('old')) {
        oldStarted.resolve()
        return first.promise
      }
      return jsonResponse(200, { data: [rawItem({ date: '2026-09-11', usage: 0.4, byok_usage_inference: 0 })] })
    }
  })
  await store.secretsSet(SECRET_KEY, 'sk-or-v1-old')
  const pending = service.query({ period: 7, forceRefresh: true })
  await oldStarted.promise
  const saved = await service.saveConnection({ apiKey: 'sk-or-v1-new' })
  assert.equal(saved.ok, true)
  first.resolve(jsonResponse(200, { data: [rawItem({ date: '2026-09-11', usage: 9, byok_usage_inference: 0 })] }))
  const stale = await pending
  assert.equal(stale.ok, false)
  if (!stale.ok) assert.equal(stale.error.code, 'discarded')
  const fresh = await service.query({ period: 7 })
  assert.equal(fresh.ok, true)
  if (fresh.ok) assert.equal(fresh.value.totals.usage, 0.4)
  assert.ok(calls >= 2)
})

test('query uses TTL cache, fills UTC gaps, and returns stale data on later network errors', async () => {
  const store = createMemoryStore({ secrets: { [SECRET_KEY]: 'sk-or-v1-live' } })
  let now = new Date('2026-09-12T12:00:00.000Z')
  let mode: 'ok' | 'down' = 'ok'
  let fetches = 0
  const service = new UsageService({
    store,
    ttlMs: 60_000,
    now: () => now,
    fetchImpl: async () => {
      fetches += 1
      if (mode === 'down') throw new Error('ECONNRESET')
      return jsonResponse(200, {
        data: [rawItem({ date: '2026-09-11', usage: 0.2, byok_usage_inference: 0, requests: 3 })]
      })
    }
  })

  const first = await service.query({ period: 7, forceRefresh: true })
  const second = await service.query({ period: 7 })
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(fetches, 1)
  if (first.ok) {
    assert.equal(first.value.daily.length, 7)
    assert.equal(first.value.totals.usage, 0.2)
  }

  now = new Date('2026-09-12T13:30:00.000Z')
  mode = 'down'
  const failed = await service.query({ period: 7, forceRefresh: true })
  assert.equal(failed.ok, false)
  if (!failed.ok) {
    assert.equal(failed.error.code, 'network')
    assert.equal(failed.snapshot?.stale, true)
    assert.equal(failed.snapshot?.totals.usage, 0.2)
  }
})

test('period change does not refetch and oversized cache is kept only in memory', async () => {
  const store = createMemoryStore({ secrets: { [SECRET_KEY]: 'sk-or-v1-live' } })
  let fetches = 0
  const huge = Array.from({ length: 200 }, (_, index) =>
    rawItem({
      date: '2026-09-11',
      model: `${String(index).padStart(3, '0')}${'m'.repeat(509)}`,
      model_permaslug: `${String(index).padStart(3, '0')}${'p'.repeat(509)}`,
      endpoint_id: `${String(index).padStart(3, '0')}${'e'.repeat(509)}`,
      provider_name: `${String(index).padStart(3, '0')}${'n'.repeat(509)}`,
      usage: 0.0001,
      byok_usage_inference: 0
    })
  )
  const service = new UsageService({
    store,
    now: () => new Date('2026-09-12T12:00:00.000Z'),
    fetchImpl: async () => {
      fetches += 1
      return jsonResponse(200, { data: huge })
    }
  })
  const month = await service.query({ period: 30, forceRefresh: true })
  const week = await service.query({ period: 7 })
  assert.equal(month.ok && week.ok, true)
  assert.equal(fetches, 1)
  assert.equal(store.storage['activity.cache.v1'], undefined)
})

test('duplicate in-flight queries share one HTTP request', async () => {
  const store = createMemoryStore({ secrets: { [SECRET_KEY]: 'sk-or-v1-live' } })
  const gate = deferred<Response>()
  const started = deferred<void>()
  let fetches = 0
  const service = new UsageService({
    store,
    now: () => new Date('2026-09-12T12:00:00.000Z'),
    fetchImpl: async () => {
      fetches += 1
      if (fetches === 1) started.resolve()
      return gate.promise
    }
  })
  const a = service.query({ period: 7, forceRefresh: true })
  await started.promise
  const b = service.query({ period: 7, forceRefresh: true })
  gate.resolve(jsonResponse(200, { data: [] }))
  const [left, right] = await Promise.all([a, b])
  assert.equal(fetches, 1)
  assert.equal(left.ok && right.ok, true)
  if (left.ok) assert.equal(left.value.empty, true)
})

test('concurrent periods do not return the first caller’s period', async () => {
  const store = createMemoryStore({ secrets: { [SECRET_KEY]: 'sk-or-v1-live' } })
  const gate = deferred<void>()
  let fetches = 0
  const service = new UsageService({
    store,
    now: () => new Date('2026-09-12T12:00:00.000Z'),
    fetchImpl: async () => {
      fetches += 1
      await gate.promise
      return jsonResponse(200, { data: [rawItem({ date: '2026-08-20', usage: 1, byok_usage_inference: 0 })] })
    }
  })
  const week = service.query({ period: 7, forceRefresh: true })
  const month = service.query({ period: 30, forceRefresh: true })
  gate.resolve()
  const [left, right] = await Promise.all([week, month])
  assert.equal(left.ok && left.value.period, 7)
  assert.equal(right.ok && right.value.period, 30)
  assert.equal(fetches, 1)
})

test('cache is not fresh after the UTC date changes', async () => {
  const store = createMemoryStore({ secrets: { [SECRET_KEY]: 'sk-or-v1-live' } })
  let now = new Date('2026-09-12T23:59:00.000Z')
  let fetches = 0
  const service = new UsageService({
    store,
    now: () => now,
    fetchImpl: async () => {
      fetches += 1
      return jsonResponse(200, { data: [] })
    }
  })
  await service.query({ period: 7 })
  now = new Date('2026-09-13T00:01:00.000Z')
  await service.query({ period: 7 })
  assert.equal(fetches, 2)
})

test('disconnect queued after save runs second and leaves the key removed', async () => {
  const store = createMemoryStore()
  const service = new UsageService({
    store,
    fetchImpl: async () => jsonResponse(200, { data: [] })
  })
  const save = service.saveConnection({ apiKey: 'sk-or-v1-newkey' })
  const remove = service.removeConnection()
  const [saved, removed] = await Promise.all([save, remove])
  assert.equal(saved.ok, true)
  assert.equal(removed.ok, true)
  assert.equal((await service.connectionStatus()).connected, false)
})
