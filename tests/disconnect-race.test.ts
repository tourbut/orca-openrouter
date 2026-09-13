import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SECRET_KEY, STORAGE_CACHE_KEY } from '../src/shared/types.ts'
import { UsageService } from '../src/worker/service.ts'
import { createMemoryStore } from '../src/worker/store.ts'

function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

test('a key read started before disconnect cannot restore usage or persistent cache', async () => {
  const store = createMemoryStore({ secrets: { [SECRET_KEY]: 'test-management-key' } })
  const entered = gate()
  const delayed = gate()
  const get = store.secretsGet
  store.secretsGet = async (key) => {
    const value = await get(key)
    entered.release()
    await delayed.promise
    return value
  }
  let fetches = 0
  const service = new UsageService({ store, fetchImpl: async () => {
    fetches++
    return new Response(JSON.stringify({ data: [] }))
  } })
  const pending = service.query({ period: 7 })
  await entered.promise
  await service.removeConnection()
  delayed.release()
  assert.equal((await pending).ok, false)
  assert.equal((await service.query({ period: 7 })).ok, false)
  assert.equal(store.storage[STORAGE_CACHE_KEY], undefined)
  assert.equal(fetches, 0)
})

test('disconnect clears a cache write already in progress', async () => {
  const store = createMemoryStore({ secrets: { [SECRET_KEY]: 'test-management-key' } })
  const entered = gate()
  const delayed = gate()
  const set = store.storageSet
  store.storageSet = async (key, value) => {
    entered.release()
    await delayed.promise
    await set(key, value)
  }
  const service = new UsageService({ store, fetchImpl: async () => new Response(JSON.stringify({ data: [] })) })
  const pending = service.query({ period: 7 })
  await entered.promise
  const removed = service.removeConnection()
  delayed.release()
  await Promise.all([pending, removed])
  assert.equal(store.storage[STORAGE_CACHE_KEY], undefined)
  assert.equal((await service.query({ period: 7 })).ok, false)
})

test('a query started during secret deletion is discarded when deletion completes', async () => {
  const store = createMemoryStore({ secrets: { [SECRET_KEY]: 'test-management-key' } })
  const deleting = gate()
  const deleteGate = gate()
  const fetching = gate()
  const fetchGate = gate()
  const remove = store.secretsDelete
  store.secretsDelete = async (key) => {
    deleting.release()
    await deleteGate.promise
    await remove(key)
  }
  const service = new UsageService({ store, fetchImpl: async () => {
    fetching.release()
    await fetchGate.promise
    return new Response(JSON.stringify({ data: [] }))
  } })
  const removed = service.removeConnection()
  await deleting.promise
  const pending = service.query({ period: 7 })
  await fetching.promise
  deleteGate.release()
  await removed
  fetchGate.release()
  assert.equal((await pending).ok, false)
  assert.equal((await service.query({ period: 7 })).ok, false)
  assert.equal(store.storage[STORAGE_CACHE_KEY], undefined)
})
