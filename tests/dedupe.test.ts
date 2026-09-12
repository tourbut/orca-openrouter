import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ActivityCache } from '../src/worker/cache.ts'
import { createMemoryStore } from '../src/worker/store.ts'

test('ActivityCache.dedupe shares one in-flight runner', async () => {
  const cache = new ActivityCache(createMemoryStore())
  let resolve!: (value: string) => void
  const gate = new Promise<string>((res) => {
    resolve = res
  })
  let runs = 0
  const run = async () => {
    runs += 1
    return gate
  }
  const first = cache.dedupe('k', run)
  const second = cache.dedupe('k', run)
  resolve('ok')
  assert.deepEqual(await Promise.all([first, second]), ['ok', 'ok'])
  assert.equal(runs, 1)
})
