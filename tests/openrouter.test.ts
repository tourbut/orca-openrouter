import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACTIVITY_URL } from '../src/shared/types.ts'
import { fetchActivity, parseActivityResponse } from '../src/worker/openrouter.ts'
import { jsonResponse, rawItem } from './helpers.ts'

test('parses a valid activity payload and rejects malformed rows', () => {
  const items = parseActivityResponse({ data: [rawItem()] })
  assert.equal(items?.length, 1)
  assert.equal(items?.[0]?.reasoningTokens, 25)
  const stamped = parseActivityResponse({
    data: [rawItem({ date: '2026-09-10 00:00:00', byok_requests: 0 })]
  })
  assert.equal(stamped?.[0]?.date, '2026-09-10')
  assert.equal(parseActivityResponse({ data: [rawItem({ usage: -1 })] }), null)
  assert.equal(parseActivityResponse({ data: [rawItem({ date: '09/11/2026' })] }), null)
  assert.equal(parseActivityResponse({ data: null }), null)
  assert.equal(parseActivityResponse({ data: [rawItem({ requests: 1.5 })] }), null)
})

test('maps 401, 403, 429, timeout, and invalid JSON without exposing the key', async () => {
  const key = 'sk-or-v1-secretvalue'
  const seen: RequestInit[] = []
  const fetchImpl = async (url: string, init: RequestInit) => {
    seen.push(init)
    assert.equal(url, ACTIVITY_URL)
    assert.equal(init.redirect, 'error')
    return jsonResponse(403, { error: { code: 403, message: 'Only management keys can perform this operation' } })
  }
  const forbidden = await fetchActivity({ apiKey: key, timeoutMs: 50, fetchImpl })
  assert.equal(forbidden.ok, false)
  if (!forbidden.ok) {
    assert.equal(forbidden.error.code, 'forbidden')
    assert.equal(forbidden.error.message.includes(key), false)
  }

  const unauthorized = await fetchActivity({
    apiKey: key,
    timeoutMs: 50,
    fetchImpl: async () => jsonResponse(401, { error: { message: 'Missing Authentication header' } })
  })
  assert.equal(unauthorized.ok, false)
  if (!unauthorized.ok) assert.equal(unauthorized.error.code, 'auth_failed')

  const limited = await fetchActivity({
    apiKey: key,
    timeoutMs: 50,
    fetchImpl: async () => jsonResponse(429, { error: { message: 'slow down' } }, { 'retry-after': '2' })
  })
  assert.equal(limited.ok, false)
  if (!limited.ok) {
    assert.equal(limited.error.code, 'rate_limited')
    assert.equal(limited.error.retryAfterMs, 2000)
  }

  const invalid = await fetchActivity({
    apiKey: key,
    timeoutMs: 50,
    fetchImpl: async () => new Response('{', { status: 200 })
  })
  assert.equal(invalid.ok, false)
  if (!invalid.ok) assert.equal(invalid.error.code, 'invalid_response')

  const timedOut = await fetchActivity({
    apiKey: key,
    timeoutMs: 20,
    fetchImpl: async (_url, init) => {
      await new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })
      throw new Error('unreachable')
    }
  })
  assert.equal(timedOut.ok, false)
  if (!timedOut.ok) assert.equal(timedOut.error.code, 'timeout')
})

test('does not coerce a 200 payload with bad numbers into zero usage', async () => {
  const result = await fetchActivity({
    apiKey: 'sk-or-v1-test',
    timeoutMs: 50,
    fetchImpl: async () => jsonResponse(200, { data: [rawItem({ usage: '0' })] })
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'invalid_response')
})
