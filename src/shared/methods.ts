import {
  METHOD_NAMES,
  type MethodName,
  type PeriodDays,
  type PreferencesUpdate,
  type QueryRequest,
  type SaveConnectionRequest
} from './types.ts'

export const PANEL_PLUGIN_REQUEST_TYPE = 'orca-panel-plugin-request'
export const PANEL_PLUGIN_RESULT_TYPE = 'orca-panel-plugin-result'

export type PanelPluginRequest = {
  type: typeof PANEL_PLUGIN_REQUEST_TYPE
  requestId: string
  method: MethodName
  params?: unknown
}

export type PanelPluginResult = {
  type: typeof PANEL_PLUGIN_RESULT_TYPE
  requestId: string
  ok: boolean
  value?: unknown
  errorCode?: string
  error?: string
}

export function isMethodName(value: unknown): value is MethodName {
  return typeof value === 'string' && (METHOD_NAMES as readonly string[]).includes(value)
}

export function parsePeriod(value: unknown): PeriodDays | null {
  return value === 7 || value === 30 ? value : null
}

export function parseQueryRequest(params: unknown): QueryRequest | { error: string } {
  if (params == null) return {}
  if (typeof params !== 'object' || Array.isArray(params)) {
    return { error: 'params must be an object' }
  }
  const record = params as Record<string, unknown>
  const extra = Object.keys(record).filter((key) => key !== 'period' && key !== 'forceRefresh')
  if (extra.length > 0) return { error: `unexpected fields: ${extra.join(', ')}` }
  const request: QueryRequest = {}
  if ('period' in record) {
    const period = parsePeriod(record.period)
    if (!period) return { error: 'period must be 7 or 30' }
    request.period = period
  }
  if ('forceRefresh' in record) {
    if (typeof record.forceRefresh !== 'boolean') return { error: 'forceRefresh must be boolean' }
    request.forceRefresh = record.forceRefresh
  }
  return request
}

export function parseSaveConnectionRequest(
  params: unknown
): SaveConnectionRequest | { error: string } {
  if (typeof params !== 'object' || params == null || Array.isArray(params)) {
    return { error: 'params must be an object' }
  }
  const record = params as Record<string, unknown>
  if (typeof record.apiKey !== 'string') return { error: 'apiKey must be a string' }
  const apiKey = record.apiKey.trim()
  if (apiKey.length < 8 || apiKey.length > 16 * 1024) {
    return { error: 'apiKey length is invalid' }
  }
  return { apiKey }
}

export function parsePreferencesUpdate(params: unknown): PreferencesUpdate | { error: string } {
  if (typeof params !== 'object' || params == null || Array.isArray(params)) {
    return { error: 'params must be an object' }
  }
  const record = params as Record<string, unknown>
  const extra = Object.keys(record).filter((key) => key !== 'period')
  if (extra.length > 0) return { error: `unexpected fields: ${extra.join(', ')}` }
  if (!('period' in record)) return {}
  const period = parsePeriod(record.period)
  if (!period) return { error: 'period must be 7 or 30' }
  return { period }
}

export function looksLikePanelPluginRequest(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === PANEL_PLUGIN_REQUEST_TYPE
  )
}
