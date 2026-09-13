// @ts-nocheck
import { loadEnvFile } from './load-env.ts'
import activate from '../dist/main.mjs'
import { SECRET_KEY } from '../src/shared/types.ts'
import { createMemoryStore } from '../src/worker/store.ts'

loadEnvFile()

const store = createMemoryStore()
const managementKey = process.env.OPENROUTER_MANAGEMENT_KEY
if (managementKey) {
  await store.secretsSet(SECRET_KEY, managementKey)
}

async function hostCall(method: string, params: unknown): Promise<{ ok: true; value: unknown } | { ok: false; code: string; error: string }> {
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
        console.log('[notify]', String(p.title ?? ''), String(p.body ?? '').slice(0, 200))
        return { ok: true, value: { delivered: true } }
      default:
        return { ok: false, code: 'unknown_method', error: method }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'host call failed'
    return { ok: false, code: 'unavailable', error: message }
  }
}

const commands = new Map<string, (args?: unknown) => Promise<unknown>>()
await activate({
  commands: {
    register(id, handler) {
      commands.set(id, handler)
    }
  },
  host: {
    async call(method, params) {
      const result = await hostCall(method, params)
      if (!result.ok) {
        const error = new Error(result.error)
        ;(error as Error & { code?: string }).code = result.code
        throw error
      }
      return result.value
    }
  },
  log(message) {
    console.log('[plugin]', String(message).slice(0, 200))
  }
})

const handler = commands.get('openrouter.openDashboard')
if (!handler) {
  console.error('openrouter.openDashboard was not registered')
  process.exit(1)
}
const result = await handler()
console.log(
  JSON.stringify({
    command: 'openrouter.openDashboard',
    ok: Boolean((result as { ok?: boolean }).ok),
    reused: (result as { reused?: boolean }).reused ?? null,
    error: (result as { error?: string }).error ?? null,
    keyPreloaded: Boolean(managementKey),
    registeredCommands: [...commands.keys()]
  })
)
const stayMs = Number(process.env.STAY_MS ?? 90_000)
if (Number.isFinite(stayMs) && stayMs > 0) {
  console.log(JSON.stringify({ stayingMs: stayMs }))
  await new Promise((resolve) => setTimeout(resolve, stayMs))
}
