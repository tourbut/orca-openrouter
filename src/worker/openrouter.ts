import { ACTIVITY_URL, type ActivityItem, type ErrorCode, type PluginError } from '../shared/types.ts'
import { parseActivityDate } from '../shared/utc.ts'
import { redactSecrets } from '../shared/redact.ts'

export const MAX_ACTIVITY_BODY_BYTES = 2 * 1024 * 1024

export type FetchImpl = (input: string, init: RequestInit) => Promise<Response>

export type ActivitySuccess = {
  ok: true
  items: ActivityItem[]
}

export type ActivityFailure = {
  ok: false
  error: PluginError
}

export type ActivityFetchResult = ActivitySuccess | ActivityFailure

function pluginError(code: ErrorCode, message: string, extra: Partial<PluginError> = {}): PluginError {
  return {
    code,
    message: redactSecrets(message),
    retryable: extra.retryable ?? false,
    retryAfterMs: extra.retryAfterMs
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function isNonNegativeInt(value: unknown): value is number {
  return isNonNegativeNumber(value) && Number.isInteger(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
}

export function parseActivityItem(raw: unknown): ActivityItem | null {
  if (typeof raw !== 'object' || raw == null || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const date = parseActivityDate(row.date)
  if (!date) return null
  if (!isNonEmptyString(row.model)) return null
  if (!isNonEmptyString(row.model_permaslug)) return null
  if (!isNonEmptyString(row.endpoint_id)) return null
  if (!isNonEmptyString(row.provider_name)) return null
  if (!isNonNegativeNumber(row.usage)) return null
  if (!isNonNegativeNumber(row.byok_usage_inference)) return null
  if (!isNonNegativeInt(row.requests)) return null
  if (!isNonNegativeInt(row.prompt_tokens)) return null
  if (!isNonNegativeInt(row.completion_tokens)) return null
  if (!isNonNegativeInt(row.reasoning_tokens)) return null
  return {
    date,
    model: row.model,
    modelPermaslug: row.model_permaslug,
    endpointId: row.endpoint_id,
    providerName: row.provider_name,
    usage: row.usage,
    byokUsageInference: row.byok_usage_inference,
    requests: row.requests,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    reasoningTokens: row.reasoning_tokens
  }
}

export function parseActivityResponse(body: unknown): ActivityItem[] | null {
  if (typeof body !== 'object' || body == null || Array.isArray(body)) return null
  const data = (body as { data?: unknown }).data
  if (!Array.isArray(data)) return null
  const items: ActivityItem[] = []
  for (const row of data) {
    const item = parseActivityItem(row)
    if (!item) return null
    items.push(item)
  }
  return items
}

function parseRetryAfter(header: string | null, now: number): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 15 * 60 * 1000)
  const date = Date.parse(header)
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - now, 15 * 60 * 1000))
  return undefined
}

function mapStatus(status: number, retryAfterMs?: number): PluginError {
  if (status === 401) {
    return pluginError('auth_failed', 'Authentication failed. Check the management key.')
  }
  if (status === 403) {
    return pluginError(
      'forbidden',
      'OpenRouter rejected this key for Activity. A management key is required.'
    )
  }
  if (status === 429) {
    return pluginError('rate_limited', 'OpenRouter rate-limited the request.', {
      retryable: true,
      retryAfterMs
    })
  }
  if (status >= 500) {
    return pluginError('network', `OpenRouter returned HTTP ${status}.`, { retryable: true })
  }
  return pluginError('invalid_response', `OpenRouter returned HTTP ${status}.`)
}

export async function fetchActivity(options: {
  apiKey: string
  timeoutMs: number
  fetchImpl: FetchImpl
  now?: () => number
}): Promise<ActivityFetchResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await options.fetchImpl(ACTIVITY_URL, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        accept: 'application/json'
      },
      redirect: 'error',
      signal: controller.signal
    })

    const retryAfterMs = parseRetryAfter(
      response.headers.get('retry-after'),
      (options.now ?? Date.now)()
    )

    const raw = Buffer.from(await response.arrayBuffer())
    if (raw.byteLength > MAX_ACTIVITY_BODY_BYTES) {
      return { ok: false, error: pluginError('invalid_response', 'Activity response exceeded size limit.') }
    }

    if (!response.ok) {
      return { ok: false, error: mapStatus(response.status, retryAfterMs) }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch {
      return { ok: false, error: pluginError('invalid_response', 'Activity response was not JSON.') }
    }

    const items = parseActivityResponse(parsed)
    if (!items) {
      return {
        ok: false,
        error: pluginError('invalid_response', 'Activity response failed validation.')
      }
    }
    return { ok: true, items }
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, error: pluginError('timeout', 'OpenRouter request timed out.', { retryable: true }) }
    }
    const message = error instanceof Error ? error.message : 'network error'
    return {
      ok: false,
      error: pluginError('network', redactSecrets(message), { retryable: true })
    }
  } finally {
    clearTimeout(timeout)
  }
}
