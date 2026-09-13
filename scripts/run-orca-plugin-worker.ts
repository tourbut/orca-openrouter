// @ts-nocheck
import { fork, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createMemoryStore } from '../src/worker/store.ts'
import { SECRET_KEY } from '../src/shared/types.ts'
import { loadEnvFile } from './load-env.ts'
import { redactSecrets } from '../src/shared/redact.ts'

const ELECTRON = '/home/shin/.local/opt/orca/squashfs-root/orca-ide'
const ENTRY = join(
  '/home/shin/.local/opt/orca/squashfs-root/resources/app.asar.unpacked/out/main',
  'plugin-host-entry.js'
)
const pluginRoot = process.cwd()

const store = createMemoryStore()
const commands = new Map<string, true>()

function workerEnv(): NodeJS.ProcessEnv {
  const allow = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR', 'TEMP', 'TMP']
  const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' }
  for (const key of allow) {
    if (process.env[key]) env[key] = process.env[key]
  }
  env.PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  env.HOME = process.env.HOME ?? homedir()
  return env
}

async function hostCall(method: string, params: unknown): Promise<{ ok: true; value: unknown } | { ok: false; error: string; errorCode: string }> {
  const p = (params ?? {}) as Record<string, unknown>
  try {
    switch (method) {
      case 'secrets.get':
        return { ok: true, value: { value: await store.secretsGet(String(p.key)) } }
      case 'secrets.set':
        await store.secretsSet(String(p.key), String(p.value))
        return { ok: true, value: { ok: true } }
      case 'secrets.delete':
        await store.secretsDelete(String(p.key))
        return { ok: true, value: { ok: true } }
      case 'storage.get':
        return { ok: true, value: { value: await store.storageGet(String(p.key)) } }
      case 'storage.set':
        await store.storageSet(String(p.key), p.value)
        return { ok: true, value: { ok: true } }
      case 'storage.delete':
        await store.storageDelete(String(p.key))
        return { ok: true, value: { ok: true } }
      case 'settings.get':
        return { ok: true, value: { settings: await store.settingsGet() } }
      case 'settings.set':
        await store.settingsSet(String(p.key), p.value)
        return { ok: true, value: { ok: true } }
      case 'notifications.show':
        console.log('[notify]', redactSecrets(`${p.title ?? ''} ${String(p.body ?? '').slice(0, 180)}`))
        return { ok: true, value: { delivered: true } }
      default:
        return { ok: false, errorCode: 'unknown_method', error: method }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: 'unavailable',
      error: error instanceof Error ? error.message : 'host call failed'
    }
  }
}

function send(child: ChildProcess, message: unknown): void {
  child.send?.(message)
}

const child = fork(ENTRY, [], {
  execPath: ELECTRON,
  env: workerEnv(),
  execArgv: [],
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  cwd: '/home/shin'
})

child.stdout?.on('data', (d) => process.stdout.write(redactSecrets(String(d))))
child.stderr?.on('data', (d) => process.stderr.write(redactSecrets(String(d))))

let ready!: () => void
const readyPromise = new Promise<void>((resolve, reject) => {
  ready = resolve
  setTimeout(() => reject(new Error('worker ready timeout')), 15_000)
})

const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let nextCall = 1

child.on('message', (raw) => {
  const msg = raw as {
    type?: string
    commands?: string[]
    callId?: number
    method?: string
    params?: unknown
    ok?: boolean
    value?: unknown
    error?: string
    level?: string
    message?: string
  }
  if (msg.type === 'ready') {
    for (const id of msg.commands ?? []) commands.set(id, true)
    ready()
    return
  }
  if (msg.type === 'log') {
    console.log(`[plugin:${msg.level}]`, redactSecrets(String(msg.message ?? '')))
    return
  }
  if (msg.type === 'hostCall') {
    void hostCall(String(msg.method), msg.params).then((outcome) => {
      send(child, {
        type: 'hostResult',
        callId: msg.callId,
        ok: outcome.ok,
        value: outcome.ok ? outcome.value : undefined,
        error: outcome.ok ? undefined : outcome.error,
        errorCode: outcome.ok ? undefined : outcome.errorCode
      })
    })
    return
  }
  if (msg.type === 'commandResult') {
    const waiter = pending.get(msg.callId ?? -1)
    if (!waiter) return
    pending.delete(msg.callId ?? -1)
    if (msg.ok) waiter.resolve(msg.value)
    else waiter.reject(new Error(msg.error ?? 'command failed'))
  }
  if (msg.type === 'fatal') {
    console.error('[fatal]', redactSecrets(String(msg.error ?? '')))
  }
})

send(child, {
  type: 'init',
  pluginId: 'tourbut.openrouter-usage',
  pluginRoot,
  mainEntry: 'dist/main.mjs',
  grantedCapabilities: ['secrets', 'storage', 'settings:own', 'notifications:show']
})

await readyPromise
console.log(JSON.stringify({ ready: true, commands: [...commands.keys()] }))

function invoke(commandId: string, args?: unknown): Promise<unknown> {
  const callId = nextCall++
  return new Promise((resolve, reject) => {
    pending.set(callId, { resolve, reject })
    send(child, { type: 'invokeCommand', callId, commandId, args })
    setTimeout(() => {
      if (pending.delete(callId)) reject(new Error(`${commandId} timed out`))
    }, 25_000)
  })
}

const opened = await invoke('openrouter.openDashboard')
console.log(JSON.stringify({ invoke: 'openrouter.openDashboard', result: opened }))

async function registerKeyFromEnv(): Promise<void> {
  loadEnvFile()
  const key = process.env.OPENROUTER_MANAGEMENT_KEY
  if (!key) {
    console.log(JSON.stringify({ keyRegister: 'skipped', reason: 'no env key' }))
    return
  }
  const { runOrcaCli, parseCliJson, resolveOrcaCli } = await import('../src/worker/cli.ts')
  const cli = resolveOrcaCli()
  const listed = await runOrcaCli(cli, [
    'tab',
    'list',
    '--worktree',
    `path:${pluginRoot}`,
    '--json'
  ])
  const tabs = ((parseCliJson(listed.stdout) as { result?: { tabs?: Array<{ url?: string }> } }).result
    ?.tabs ?? []) as Array<{ url?: string }>
  const dash = tabs.find((tab) => (tab.url ?? '').includes('127.0.0.1:'))
  const url = dash?.url ?? ''
  const originMatch = url.match(/^(https?:\/\/127\.0\.0\.1:\d+)/)
  const origin = originMatch?.[1]
  const entry = new URL(url || 'http://127.0.0.1/').searchParams.get('entry')
  if (!origin) {
    console.log(JSON.stringify({ keyRegister: 'no-dashboard-tab' }))
    return
  }
  let session = ''
  if (entry) {
    const exchanged = await fetch(`${origin}/api/session/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ entryToken: entry })
    })
    const body = (await exchanged.json()) as { ok?: boolean; value?: { sessionToken?: string } }
    session = body.value?.sessionToken ?? ''
  }
  if (!session) {
    await store.secretsSet(SECRET_KEY, key)
    console.log(JSON.stringify({ keyRegister: 'stored-in-worker-secrets', originHost: '127.0.0.1' }))
    return
  }
  const saved = await fetch(`${origin}/api/connection/save`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      authorization: `Bearer ${session}`
    },
    body: JSON.stringify({ apiKey: key })
  })
  const savedBody = (await saved.json()) as { ok?: boolean; errorCode?: string }
  console.log(
    JSON.stringify({
      keyRegister: savedBody.ok ? 'saved-via-dashboard-api' : 'save-failed',
      errorCode: savedBody.errorCode ?? null,
      connected: savedBody.ok === true
    })
  )
}

if (process.env.REGISTER_KEY === '1') {
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.REGISTER_DELAY_MS ?? 8_000)))
  await registerKeyFromEnv()
}

const stayMs = Number(process.env.STAY_MS ?? 90_000)
console.log(JSON.stringify({ stayingMs: stayMs, secretPresent: Boolean(await store.secretsGet(SECRET_KEY)) }))
await new Promise((resolve) => setTimeout(resolve, stayMs))
send(child, { type: 'shutdown' })
