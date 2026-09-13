import type { ActivityItem } from '../src/shared/types.ts'
import { addUtcDays, utcDateString } from '../src/shared/utc.ts'

export function item(overrides: Partial<ActivityItem> & Pick<ActivityItem, 'date'>): ActivityItem {
  return {
    model: 'openai/gpt-4.1',
    modelPermaslug: 'openai/gpt-4.1-2025-04-14',
    endpointId: 'endpoint-openai',
    providerName: 'OpenAI',
    usage: 0.015,
    byokUsageInference: 0,
    requests: 5,
    promptTokens: 50,
    completionTokens: 125,
    reasoningTokens: 25,
    ...overrides
  }
}

export function rawItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date: '2026-09-10',
    model: 'openai/gpt-4.1',
    model_permaslug: 'openai/gpt-4.1-2025-04-14',
    endpoint_id: 'endpoint-openai',
    provider_name: 'OpenAI',
    usage: 0.015,
    byok_usage_inference: 0.012,
    requests: 5,
    prompt_tokens: 50,
    completion_tokens: 125,
    reasoning_tokens: 25,
    ...overrides
  }
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

export function frozenNow(iso = '2026-09-12T15:04:05.000Z'): Date {
  return new Date(iso)
}

export function yesterday(now = frozenNow()): string {
  return addUtcDays(utcDateString(now), -1)
}
