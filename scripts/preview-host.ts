import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnvFile } from './load-env.ts'
import { UsageService } from '../src/worker/service.ts'
import { createMemoryStore } from '../src/worker/store.ts'
import { SECRET_KEY } from '../src/shared/types.ts'
import { PanelRequestDispatcher, createFixedWindowAdmission } from '../host-patch/dispatcher.ts'
import {
  looksLikePanelPluginRequest,
  parsePanelPluginRequest,
  toResultMessage,
  type SessionRecord
} from '../host-patch/protocol.ts'
import { METHOD_NAMES, type MethodName } from '../src/shared/types.ts'

loadEnvFile()
const store = createMemoryStore()
const apiKey = process.env.OPENROUTER_MANAGEMENT_KEY
if (apiKey) await store.secretsSet(SECRET_KEY, apiKey)

const service = new UsageService({
  store,
  fetchImpl: globalThis.fetch.bind(globalThis)
})
if (apiKey) await service.hydrateFromStorage(apiKey)

const sessionToken = 'preview-session-token-openrouter-usage-32'
const sessions = new Map<string, SessionRecord>([
  [
    sessionToken,
    {
      sessionToken,
      pluginKey: 'tourbut.openrouter-usage',
      panelId: 'usage',
      allowedMethods: new Set(METHOD_NAMES),
      consented: true,
      enabled: true,
      alive: true
    }
  ]
])

const dispatcher = new PanelRequestDispatcher(
  sessions,
  async (_pluginKey, method, params) => {
    const result = await service.dispatch(method as MethodName, params)
    if (result.ok) return { ok: true, value: result.value }
    return {
      ok: false,
      code: result.error.code,
      error: result.error.message,
      value: result.snapshot
    }
  },
  createFixedWindowAdmission()
)

const panelPath = join(process.cwd(), 'dist/panel.html')
if (!existsSync(panelPath)) {
  throw new Error('dist/panel.html missing; run npm run build first')
}

const parentPage = `<!doctype html>
<meta charset="utf-8">
<title>OpenRouter Usage preview host</title>
<style>
  html, body, iframe { margin: 0; height: 100%; width: 100%; border: 0; background: #111; }
  body { font-family: system-ui; color: #ddd; }
</style>
<iframe id="panel" src="/panel.html" sandbox="allow-scripts"></iframe>
<script>
  const frame = document.getElementById('panel')
  window.addEventListener('message', async (event) => {
    if (event.source !== frame.contentWindow) return
    const res = await fetch('/bridge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event.data)
    })
    frame.contentWindow.postMessage(await res.json(), '*')
  })
</script>`

const server = createServer(async (req, res) => {
  const url = req.url ?? '/'
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(parentPage)
    return
  }
  if (url === '/panel.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(readFileSync(panelPath))
    return
  }
  if (url === '/bridge' && req.method === 'POST') {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!looksLikePanelPluginRequest(data)) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'ignored' }))
      return
    }
    const parsed = parsePanelPluginRequest(data)
    const requestId = parsed.ok ? parsed.request.requestId : parsed.requestId ?? 'unknown'
    const result = await dispatcher.handlePanelMessage(sessionToken, data)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(toResultMessage(requestId, result)))
    return
  }
  res.writeHead(404)
  res.end()
})

const port = Number(process.env.PORT ?? 4173)
server.listen(port, '127.0.0.1', () => {
  console.log(`preview host on http://127.0.0.1:${port}`)
  console.log('management key loaded:', Boolean(apiKey))
  console.log('this is a local host stand-in, not installed Orca 1.4.198')
})
