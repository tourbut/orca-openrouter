import {
  PANEL_PLUGIN_REQUEST_TYPE,
  PANEL_PLUGIN_RESULT_TYPE,
  type PanelPluginResult
} from '../shared/methods.ts'
import type { MethodName } from '../shared/types.ts'

export class HostMissingError extends Error {
  readonly code = 'host_missing' as const
  constructor(message = 'Orca panel-to-worker request bridge is not available.') {
    super(message)
    this.name = 'HostMissingError'
  }
}

export type PanelBridge = {
  request(method: MethodName, params?: unknown): Promise<unknown>
  probe(timeoutMs?: number): Promise<boolean>
}

export function createPanelBridge(
  target: Window = window.parent,
  incoming: Window = window
): PanelBridge {
  let seq = 0
  const pending = new Map<
    string,
    { resolve: (value: PanelPluginResult) => void; timer: ReturnType<typeof setTimeout> }
  >()

  incoming.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as PanelPluginResult | undefined
    if (!data || data.type !== PANEL_PLUGIN_RESULT_TYPE || typeof data.requestId !== 'string') return
    const waiter = pending.get(data.requestId)
    if (!waiter) return
    clearTimeout(waiter.timer)
    pending.delete(data.requestId)
    waiter.resolve(data)
  })

  function send(method: MethodName, params: unknown, timeoutMs: number): Promise<PanelPluginResult> {
    const requestId = `req-${++seq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new HostMissingError())
      }, timeoutMs)
      pending.set(requestId, { resolve, timer })
      target.postMessage(
        { type: PANEL_PLUGIN_REQUEST_TYPE, requestId, method, params },
        '*'
      )
    })
  }

  return {
    async request(method, params) {
      const timeoutMs = method === 'usage.query' || method === 'connection.save' ? 15_000 : 8_000
      const result = await send(method, params, timeoutMs)
      if (!result.ok) {
        const error = new Error(result.error || result.errorCode || 'request failed')
        ;(error as Error & { code?: string; value?: unknown }).code = result.errorCode
        ;(error as Error & { value?: unknown }).value = result.value
        throw error
      }
      return result.value
    },
    async probe(timeoutMs = 1500) {
      try {
        const result = await send('connection.status', undefined, timeoutMs)
        return result.type === PANEL_PLUGIN_RESULT_TYPE
      } catch (error) {
        return !(error instanceof HostMissingError) && false
      }
    }
  }
}
