import { redactSecrets } from '../shared/redact.ts'
import type { MethodName } from '../shared/types.ts'
import { isMethodName } from '../shared/methods.ts'
import { SECRET_KEY } from '../shared/types.ts'
import { DashboardRuntime, pluginRootFromModuleUrl } from './open-dashboard.ts'
import { formatNotificationSummary, UsageService } from './service.ts'
import { createOrcaStore, type OrcaApi } from './store.ts'

type RequestApi = {
  register(method: string, handler: (params: unknown) => Promise<unknown>): void
}

type PluginOrca = OrcaApi & {
  commands: { register(id: string, handler: (args?: unknown) => Promise<unknown>): void }
  requests?: RequestApi
}

type Runtime = {
  stop(): Promise<void>
}

let runtime: Runtime | null = null

function notificationBody(result: Awaited<ReturnType<UsageService['query']>>): string {
  if (result.ok) return formatNotificationSummary(result.value)
  const suffix = result.snapshot ? ` Last data: ${formatNotificationSummary(result.snapshot)}.` : ''
  return `${result.error.message}${suffix}`
}

export default async function activate(orca: PluginOrca): Promise<void> {
  const store = createOrcaStore(orca)
  const service = new UsageService({
    store,
    fetchImpl: globalThis.fetch.bind(globalThis)
  })
  const existing = await store.secretsGet(SECRET_KEY)
  await service.hydrateFromStorage(existing)
  const pluginRoot = pluginRootFromModuleUrl(import.meta.url)
  const dashboard = new DashboardRuntime(orca, service, pluginRoot)
  runtime = dashboard

  orca.commands.register('openrouter.openDashboard', async () => {
    const result = await dashboard.open()
    await store.notify?.(
      'OpenRouter Usage',
      result.ok
        ? 'Opened the usage dashboard in an Orca browser tab.'
        : result.error ?? 'Could not open the dashboard.'
    )
    return result.ok ? { ok: true, reused: result.reused } : { ok: false, error: result.error }
  })

  orca.commands.register('openrouter.status', async () => {
    const status = await service.connectionStatus()
    await store.notify?.(
      'OpenRouter Usage',
      status.connected ? 'Management key is stored.' : 'No management key is stored.'
    )
    return status
  })

  orca.commands.register('openrouter.refresh', async () => {
    const result = await service.query({ forceRefresh: true })
    await store.notify?.('OpenRouter Usage', notificationBody(result))
    return result.ok
      ? {
          ok: true,
          period: result.value.period,
          totals: result.value.totals,
          dataEndDate: result.value.dataEndDate,
          empty: result.value.empty
        }
      : { ok: false, code: result.error.code, message: result.error.message }
  })

  orca.commands.register('openrouter.disconnect', async () => {
    const result = await service.removeConnection()
    await store.notify?.('OpenRouter Usage', 'Disconnected. Cached activity was cleared.')
    return result.ok ? result.value : { ok: false, code: result.error.code }
  })

  if (orca.requests && typeof orca.requests.register === 'function') {
    const dispatch = (method: MethodName, params: unknown) => service.dispatch(method, params)
    for (const method of [
      'connection.status',
      'connection.save',
      'connection.remove',
      'usage.query',
      'preferences.update'
    ] as const) {
      orca.requests.register(method, (params) => dispatch(method, params))
    }
  } else {
    orca.log('panel request API is not present; use Open Dashboard')
  }
}

export async function deactivate(): Promise<void> {
  await runtime?.stop()
  runtime = null
}

export function createStandaloneDispatcher(service: UsageService) {
  return async (method: string, params: unknown) => {
    if (!isMethodName(method)) {
      return {
        ok: false,
        error: { code: 'unknown_method', message: redactSecrets(`unknown method: ${method}`), retryable: false }
      }
    }
    return service.dispatch(method, params)
  }
}
