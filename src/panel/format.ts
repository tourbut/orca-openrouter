import type { Totals } from '../shared/types.ts'

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const digits = Math.abs(value) > 0 && Math.abs(value) < 0.0001 ? 6 : 4
  return `$${value.toFixed(digits)}`
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

export function formatTotals(totals: Totals): {
  usage: string
  requests: string
  prompt: string
  completion: string
  reasoning: string
  byok: string
} {
  return {
    usage: formatUsd(totals.usage),
    requests: formatCount(totals.requests),
    prompt: formatCount(totals.promptTokens),
    completion: formatCount(totals.completionTokens),
    reasoning: formatCount(totals.reasoningTokens),
    byok: formatUsd(totals.byokUsageInference)
  }
}
