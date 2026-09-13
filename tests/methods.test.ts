import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseQueryRequest, parseSaveConnectionRequest } from '../src/shared/methods.ts'
import { assertNoSecret, redactSecrets } from '../src/shared/redact.ts'

test('query params accept only period and forceRefresh', () => {
  assert.deepEqual(parseQueryRequest({ period: 7, forceRefresh: true }), {
    period: 7,
    forceRefresh: true
  })
  assert.equal('error' in parseQueryRequest({ period: 14 }), true)
  assert.equal('error' in parseQueryRequest({ pluginId: 'tourbut.openrouter-usage' }), true)
})

test('connection.save requires a key and ignores nothing about host identity', () => {
  const parsed = parseSaveConnectionRequest({ apiKey: 'sk-or-v1-abcdefghi' })
  assert.equal('apiKey' in parsed, true)
  assert.equal('error' in parseSaveConnectionRequest({ apiKey: 'short' }), true)
})

test('redaction strips bearer tokens from strings and objects', () => {
  const text = redactSecrets('Authorization: Bearer sk-or-v1-abcdef and more')
  assert.equal(text.includes('abcdef'), false)
  assert.doesNotThrow(() => assertNoSecret({ totals: { usage: 1 } }))
  assert.throws(() => assertNoSecret({ key: 'sk-or-v1-abcdefghijkl' }))
})
