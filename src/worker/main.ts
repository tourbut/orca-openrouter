import { redactSecrets } from '../shared/redact.ts'
import type { MethodName } from '../shared/types.ts'
import { isMethodName } from '../shared/methods.ts'
import { SECRET_KEY } from '../shared/types.ts'
import { formatNotificationSummary, UsageService } from './service.ts'
import { createOrcaStore, type OrcaApi } from './store.ts'

type RequestApi = {
  register(method: string, handler: (params: unknown) => Promise<unknown>): void
}

type PluginOrca = OrcaApi & {
  commands: { register(id: string, handler: (args?: unknown) => Promise<unknown>): void }
  requests?: RequestApi
}

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

  const dispatch = (method: MethodName, params: unknown) => service.dispatch(method, params)

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
    const register = (method: MethodName) => {
      orca.requests!.register(method, (params) => dispatch(method, params))
    }
    register('connection.status')
    register('connection.save')
    register('connection.remove')
    register('usage.query')
    register('preferences.update')
  } else {
    orca.log('panel request API is not present on this Orca host')
  }
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
