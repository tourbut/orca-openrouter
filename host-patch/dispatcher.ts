import { jsonUtf8Bytes } from '../src/shared/bytes.ts'
import { PANEL_MESSAGE_MAX_BYTES, type MethodName } from '../src/shared/types.ts'
import { redactSecrets } from '../src/shared/redact.ts'
import {
  parsePanelPluginRequest,
  type DispatchResult,
  type SessionRecord,
  type TrustedPluginCall
} from './protocol.ts'

export type WorkerInvoker = (
  pluginKey: string,
  method: MethodName,
  params: unknown,
  generation: number
) => Promise<DispatchResult>

export type Admission = {
  admit(pluginKey: string, message: unknown): 'ok' | 'oversized' | 'rate_limited'
}

export class PanelRequestDispatcher {
  constructor(
    private readonly sessions: Map<string, SessionRecord>,
    private readonly invoke: WorkerInvoker,
    private readonly admission?: Admission,
    private readonly now: () => number = Date.now
  ) {}

  async handlePanelMessage(sessionToken: string, data: unknown): Promise<DispatchResult> {
    const parsed = parsePanelPluginRequest(data)
    if (!parsed.ok) {
      return { ok: false, code: 'invalid_request', error: parsed.error }
    }
    return this.handleTrustedCall({
      sessionToken,
      method: parsed.request.method,
      params: parsed.request.params
    })
  }

  async handleTrustedCall(call: TrustedPluginCall): Promise<DispatchResult> {
    const session = this.sessions.get(call.sessionToken)
    if (!session || !session.alive) {
      return { ok: false, code: 'unavailable', error: 'panel session is no longer active' }
    }
    if (!session.enabled) {
      return { ok: false, code: 'unavailable', error: 'plugin is disabled' }
    }
    if (!session.consented) {
      return { ok: false, code: 'consent_required', error: 'plugin consent is required' }
    }
    if (this.admission) {
      const decision = this.admission.admit(session.pluginKey, {
        method: call.method,
        params: call.params
      })
      if (decision === 'oversized') {
        return { ok: false, code: 'invalid_request', error: 'panel message exceeds the size limit' }
      }
      if (decision === 'rate_limited') {
        return { ok: false, code: 'rate_limited', error: 'too many panel requests' }
      }
    }
    if (!session.allowedMethods.has(call.method as MethodName)) {
      return { ok: false, code: 'unknown_method', error: 'method is not registered for this plugin' }
    }

    const generation = this.now()
    const result = await this.invoke(
      session.pluginKey,
      call.method as MethodName,
      call.params,
      generation
    )
    const current = this.sessions.get(call.sessionToken)
    if (
      !current ||
      !current.alive ||
      !current.enabled ||
      !current.consented ||
      current.pluginKey !== session.pluginKey
    ) {
      return { ok: false, code: 'unavailable', error: 'panel session is no longer active' }
    }
    if (jsonUtf8Bytes(result) > PANEL_MESSAGE_MAX_BYTES) {
      return {
        ok: false,
        code: 'action_failed',
        error: 'worker result exceeded the panel message limit'
      }
    }
    if (!result.ok) {
      return { ...result, error: redactSecrets(result.error) }
    }
    return result
  }
}

export function createFixedWindowAdmission(options?: {
  maxMessages?: number
  perMs?: number
  maxBytes?: number
  now?: () => number
}): Admission {
  const maxMessages = options?.maxMessages ?? 30
  const perMs = options?.perMs ?? 10_000
  const maxBytes = options?.maxBytes ?? PANEL_MESSAGE_MAX_BYTES
  const now = options?.now ?? Date.now
  const windows = new Map<string, number[]>()
  return {
    admit(pluginKey, message) {
      if (jsonUtf8Bytes(message) > maxBytes) return 'oversized'
      const stamp = now()
      const series = (windows.get(pluginKey) ?? []).filter((time) => stamp - time < perMs)
      if (series.length >= maxMessages) {
        windows.set(pluginKey, series)
        return 'rate_limited'
      }
      series.push(stamp)
      windows.set(pluginKey, series)
      return 'ok'
    }
  }
}
