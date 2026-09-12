import assert from 'node:assert/strict'
import { test } from 'node:test'
import { METHOD_NAMES, type MethodName } from '../src/shared/types.ts'
import { PANEL_PLUGIN_REQUEST_TYPE } from '../src/shared/methods.ts'
import { createFixedWindowAdmission, PanelRequestDispatcher } from '../host-patch/dispatcher.ts'
import { parsePanelPluginRequest, toResultMessage, type SessionRecord } from '../host-patch/protocol.ts'

const token = 'a'.repeat(32)

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionToken: token,
    pluginKey: 'tourbut.openrouter-usage',
    panelId: 'usage',
    allowedMethods: new Set(METHOD_NAMES),
    consented: true,
    enabled: true,
    alive: true,
    ...overrides
  }
}

test('panel requests cannot supply plugin identity or a foreign method', () => {
  const stolen = parsePanelPluginRequest({
    type: PANEL_PLUGIN_REQUEST_TYPE,
    requestId: 'r1',
    method: 'usage.query',
    pluginKey: 'evil.other',
    params: {}
  })
  assert.equal(stolen.ok, false)
  if (!stolen.ok) assert.match(stolen.error, /identity/)

  const hostMethod = parsePanelPluginRequest({
    type: PANEL_PLUGIN_REQUEST_TYPE,
    requestId: 'r2',
    method: 'secrets.get',
    params: { key: 'openrouter.managementKey' }
  })
  assert.equal(hostMethod.ok, false)
})

test('dispatcher uses the session plugin key and drops dead sessions', async () => {
  const sessions = new Map([[token, session()]])
  const seen: string[] = []
  const dispatcher = new PanelRequestDispatcher(sessions, async (pluginKey, method) => {
    seen.push(`${pluginKey}:${method}`)
    return { ok: true, value: { connected: true } }
  })
  const ok = await dispatcher.handlePanelMessage(token, {
    type: PANEL_PLUGIN_REQUEST_TYPE,
    requestId: 'r3',
    method: 'connection.status'
  })
  assert.equal(ok.ok, true)
  assert.deepEqual(seen, ['tourbut.openrouter-usage:connection.status'])

  sessions.set(token, session({ alive: false }))
  const dead = await dispatcher.handlePanelMessage(token, {
    type: PANEL_PLUGIN_REQUEST_TYPE,
    requestId: 'r4',
    method: 'connection.status'
  })
  assert.equal(dead.ok, false)
  if (!dead.ok) assert.equal(dead.code, 'unavailable')
})

test('rate-limits and oversized worker results are rejected', async () => {
  const sessions = new Map([[token, session()]])
  const req = {
    type: PANEL_PLUGIN_REQUEST_TYPE,
    requestId: 'r5',
    method: 'usage.query' as MethodName,
    params: { period: 7 }
  }
  const oversizedDispatcher = new PanelRequestDispatcher(sessions, async () => ({
    ok: true,
    value: { blob: 'x'.repeat(70_000) }
  }))
  const oversized = await oversizedDispatcher.handlePanelMessage(token, req)
  assert.equal(oversized.ok, false)
  if (!oversized.ok) assert.equal(oversized.code, 'action_failed')

  const limited = new PanelRequestDispatcher(
    sessions,
    async () => ({ ok: true, value: { ok: true } }),
    createFixedWindowAdmission({ maxMessages: 1, perMs: 10_000, now: () => 5 })
  )
  assert.equal((await limited.handlePanelMessage(token, req)).ok, true)
  const third = await limited.handlePanelMessage(token, req)
  assert.equal(third.ok, false)
  if (!third.ok) assert.equal(third.code, 'rate_limited')
})

test('error strings are redacted before they go back to the panel', () => {
  const message = toResultMessage('r6', {
    ok: false,
    code: 'auth_failed',
    error: 'Bearer sk-or-v1-supersecret failed'
  })
  assert.equal(message.ok, false)
  assert.equal(String(message.error).includes('supersecret'), false)
  assert.match(String(message.error), /redacted/)
})
