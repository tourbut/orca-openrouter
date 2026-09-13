import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: ['src/web/main.ts'], bundle: true, format: 'iife', write: false,
  plugins: [{ name: 'capture-render', setup(builder) {
    builder.onLoad({ filter: /src\/panel\/render\.ts$/ }, () => ({
      contents: 'export function renderPanel(root,state,handlers){globalThis.currentState=state;globalThis.handlers=handlers}', loader: 'js'
    }))
  } }]
})
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

test('dashboard shows network recovery and does not report a failed disconnect as success', async () => {
  let offline = false
  const context = vm.createContext({
    document: { getElementById: () => ({}) }, URLSearchParams,
    location: { search: '' }, history: { replaceState() {} },
    sessionStorage: { getItem: () => 'test-session', removeItem() {}, setItem() {} },
    fetch: async (path: string) => {
      if (offline) throw new Error('Failed to fetch')
      if (path.endsWith('/remove')) return { status: 200, json: async () => ({ ok: false, error: 'Secret deletion failed' }) }
      return { status: 200, json: async () => ({ ok: true, value: path.endsWith('/status') ? { connected: true } : { period: 7 } }) }
    }
  })
  vm.runInContext(bundle.outputFiles[0]!.text, context)
  await tick()
  context.handlers.disconnect()
  await tick()
  assert.equal(context.currentState.view.kind, 'error')
  assert.equal(context.currentState.view.error.message, 'Secret deletion failed')
  offline = true
  context.handlers.refresh()
  await tick()
  assert.equal(context.currentState.view.kind, 'error')
  assert.match(context.currentState.view.error.message, /OpenRouter: Open Dashboard again/)
  context.handlers.saveKey('test-management-key')
  await tick()
  assert.equal(context.currentState.view.kind, 'error')
})
