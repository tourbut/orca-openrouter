import {
  PANEL_PLUGIN_REQUEST_TYPE,
  PANEL_PLUGIN_RESULT_TYPE,
  isMethodName,
  type PanelPluginRequest,
  type PanelPluginResult
} from '../src/shared/methods.ts'
import { METHOD_NAMES, PANEL_MESSAGE_MAX_BYTES, type MethodName } from '../src/shared/types.ts'
import { jsonUtf8Bytes } from '../src/shared/bytes.ts'
import { redactSecrets } from '../src/shared/redact.ts'

export const PANEL_PLUGIN_REQUEST_TIMEOUT_MS = 20_000
export const ALLOWED_PANEL_METHODS: readonly MethodName[] = METHOD_NAMES

export type SessionRecord = {
  sessionToken: string
  pluginKey: string
  panelId: string
  allowedMethods: ReadonlySet<MethodName>
  consented: boolean
  enabled: boolean
  alive: boolean
}

export type TrustedPluginCall = {
  sessionToken: string
  method: string
  params?: unknown
}

export type DispatchErrorCode =
  | 'invalid_request'
  | 'unknown_method'
  | 'capability_denied'
  | 'consent_required'
  | 'unavailable'
  | 'invalid_params'
  | 'rate_limited'
  | 'action_failed'
  | 'not_connected'
  | 'auth_failed'
  | 'forbidden'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'host_missing'
  | 'discarded'

export type DispatchResult =
  | { ok: true; value: unknown }
  | { ok: false; code: DispatchErrorCode; error: string; value?: unknown }

export function parsePanelPluginRequest(data: unknown):
  | { ok: true; request: PanelPluginRequest }
  | { ok: false; requestId: string | null; error: string } {
  if (typeof data !== 'object' || data == null) {
    return { ok: false, requestId: null, error: 'request must be an object' }
  }
  const record = data as Record<string, unknown>
  const requestId =
    typeof record.requestId === 'string' && record.requestId.length > 0 && record.requestId.length <= 128
      ? record.requestId
      : null
  if (record.type !== PANEL_PLUGIN_REQUEST_TYPE) {
    return { ok: false, requestId, error: 'type must be orca-panel-plugin-request' }
  }
  if (!isMethodName(record.method)) {
    return { ok: false, requestId, error: 'method is not an allowed worker method' }
  }
  if (jsonUtf8Bytes(data) > PANEL_MESSAGE_MAX_BYTES) {
    return { ok: false, requestId, error: 'panel message exceeds the size limit' }
  }
  if ('pluginId' in record || 'pluginKey' in record || 'sessionToken' in record) {
    return { ok: false, requestId, error: 'caller identity is not panel-supplied' }
  }
  return {
    ok: true,
    request: {
      type: PANEL_PLUGIN_REQUEST_TYPE,
      requestId: requestId ?? '',
      method: record.method,
      params: record.params
    }
  }
}

export function looksLikePanelPluginRequest(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === PANEL_PLUGIN_REQUEST_TYPE
  )
}

export function toResultMessage(
  requestId: string,
  result: DispatchResult
): PanelPluginResult {
  if (result.ok) {
    return { type: PANEL_PLUGIN_RESULT_TYPE, requestId, ok: true, value: result.value }
  }
  return {
    type: PANEL_PLUGIN_RESULT_TYPE,
    requestId,
    ok: false,
    errorCode: result.code,
    error: redactSecrets(result.error),
    value: result.value
  }
}

export { PANEL_PLUGIN_REQUEST_TYPE, PANEL_PLUGIN_RESULT_TYPE, ALLOWED_PANEL_METHODS as allowedMethods }
