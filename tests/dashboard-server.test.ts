import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DashboardServer } from '../src/worker/dashboard-server.ts'
import { UsageService } from '../src/worker/service.ts'
import { createMemoryStore } from '../src/worker/store.ts'
import { SECRET_KEY } from '../src/shared/types.ts'

test('loopback dashboard requires a one-time entry token and rejects unauthenticated API calls', async () => {
  const root = mkdtempSync(join(tmpdir(), 'or-dash-'))
  mkdirSync(join(root, 'dist'))
  writeFileSync(join(root, 'dist', 'dashboard.html'), '<html><body>ok</body></html>')
  writeFileSync(join(root, 'dist', 'dashboard.js'), '')
  const store = createMemoryStore({ secrets: { [SECRET_KEY]: 'sk-or-v1-live' } })
  const service = new UsageService({
    store,
    fetchImpl: async () => new Response(JSON.stringify({ data: [] }), { status: 200 })
  })
  const server = new DashboardServer({ pluginRoot: root, service })
  const { origin } = await server.listen()
  try {
    const denied = await fetch(`${origin}/api/connection/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: '{}'
    })
    assert.equal(denied.status, 401)

    const foreign = await fetch(`${origin}/api/session/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify({ entryToken: 'x' })
    })
    assert.equal(foreign.status, 403)

    const entryUrl = server.mintEntryUrl()
    const token = new URL(entryUrl).searchParams.get('entry') ?? ''
    const first = await fetch(`${origin}/api/session/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ entryToken: token })
    })
    const firstBody = (await first.json()) as { ok: boolean; value?: { sessionToken: string } }
    assert.equal(first.ok, true)
    assert.equal(firstBody.ok, true)
    const session = firstBody.value?.sessionToken ?? ''
    assert.ok(session.length > 8)

    const reuse = await fetch(`${origin}/api/session/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ entryToken: token })
    })
    const reuseBody = (await reuse.json()) as { ok: boolean; value?: { sessionToken: string } }
    assert.equal(reuse.status, 401)
    assert.equal(reuseBody.ok, false)

    const stale = await fetch(`${origin}/api/session/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ entryToken: 'dead' })
    })
    assert.equal(stale.status, 401)

    const status = await fetch(`${origin}/api/connection/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
        authorization: `Bearer ${session}`
      },
      body: '{}'
    })
    const statusBody = (await status.json()) as { ok: boolean; value?: { connected: boolean } }
    assert.equal(statusBody.ok, true)
    assert.equal(statusBody.value?.connected, true)
  } finally {
    await server.close()
  }
})
