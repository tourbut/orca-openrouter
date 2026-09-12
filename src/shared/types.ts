export const ACTIVITY_URL = 'https://openrouter.ai/api/v1/activity'
export const SECRET_KEY = 'openrouter.managementKey'
export const SETTINGS_PERIOD_KEY = 'period'
export const STORAGE_CACHE_KEY = 'activity.cache.v1'
export const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000
export const PLUGIN_STORAGE_VALUE_MAX_BYTES = 256 * 1024
export const PANEL_MESSAGE_MAX_BYTES = 64 * 1024
export const PANEL_RESULT_SOFT_MAX_BYTES = 48 * 1024

export type PeriodDays = 7 | 30

export type ActivityItem = {
  date: string
  model: string
  modelPermaslug: string
  endpointId: string
  providerName: string
  usage: number
  byokUsageInference: number
  requests: number
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
}

export type Totals = {
  usage: number
  byokUsageInference: number
  requests: number
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
}

export type DailyBucket = {
  date: string
  totals: Totals
}

export type ProviderBucket = {
  providerName: string
  endpointId: string
  totals: Totals
}

export type ModelBucket = {
  model: string
  modelPermaslug: string
  totals: Totals
  providers: ProviderBucket[]
}

export type UsageSnapshot = {
  period: PeriodDays
  fetchedAt: string
  dataEndDate: string
  dataStartDate: string
  stale: boolean
  cache: 'fresh' | 'stale' | 'memory' | 'none'
  totals: Totals
  daily: DailyBucket[]
  models: ModelBucket[]
  modelsTruncated: boolean
  empty: boolean
}

export type ErrorCode =
  | 'not_connected'
  | 'auth_failed'
  | 'forbidden'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'unavailable'
  | 'invalid_params'
  | 'host_missing'
  | 'unknown_method'
  | 'discarded'

export type PluginError = {
  code: ErrorCode
  message: string
  retryAfterMs?: number
  retryable: boolean
}

export type ConnectionStatus = {
  connected: boolean
}

export type QueryRequest = {
  period?: PeriodDays
  forceRefresh?: boolean
}

export type SaveConnectionRequest = {
  apiKey: string
}

export type PreferencesUpdate = {
  period?: PeriodDays
}

export type MethodName =
  | 'connection.status'
  | 'connection.save'
  | 'connection.remove'
  | 'usage.query'
  | 'preferences.update'

export const METHOD_NAMES: readonly MethodName[] = [
  'connection.status',
  'connection.save',
  'connection.remove',
  'usage.query',
  'preferences.update'
] as const

export type MethodResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PluginError; snapshot?: UsageSnapshot }

export const ZERO_TOTALS: Totals = {
  usage: 0,
  byokUsageInference: 0,
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0
}
