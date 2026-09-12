import {
  PANEL_RESULT_SOFT_MAX_BYTES,
  ZERO_TOTALS,
  type ActivityItem,
  type DailyBucket,
  type ModelBucket,
  type PeriodDays,
  type ProviderBucket,
  type Totals,
  type UsageSnapshot
} from '../shared/types.ts'
import { jsonUtf8Bytes } from '../shared/bytes.ts'
import { completedUtcWindow, dateInInclusiveRange } from '../shared/utc.ts'

export function addTotals(a: Totals, b: Totals): Totals {
  return {
    usage: a.usage + b.usage,
    byokUsageInference: a.byokUsageInference + b.byokUsageInference,
    requests: a.requests + b.requests,
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens
  }
}

export function totalsFromItem(item: ActivityItem): Totals {
  return {
    usage: item.usage,
    byokUsageInference: item.byokUsageInference,
    requests: item.requests,
    promptTokens: item.promptTokens,
    completionTokens: item.completionTokens,
    reasoningTokens: item.reasoningTokens
  }
}

function modelKey(item: ActivityItem): string {
  return `${item.model}\0${item.modelPermaslug}`
}

function providerKey(item: ActivityItem): string {
  return `${item.providerName}\0${item.endpointId}`
}

export function aggregateActivity(
  items: ActivityItem[],
  period: PeriodDays,
  now: Date,
  fetchedAt: Date,
  cache: UsageSnapshot['cache'],
  stale: boolean
): UsageSnapshot {
  const window = completedUtcWindow(now, period)
  const inWindow = items.filter((item) => dateInInclusiveRange(item.date, window.start, window.end))

  const dailyMap = new Map<string, Totals>()
  for (const date of window.dates) dailyMap.set(date, { ...ZERO_TOTALS })

  const models = new Map<string, { model: string; modelPermaslug: string; totals: Totals; providers: Map<string, ProviderBucket> }>()

  let totals = { ...ZERO_TOTALS }
  for (const item of inWindow) {
    const piece = totalsFromItem(item)
    totals = addTotals(totals, piece)
    dailyMap.set(item.date, addTotals(dailyMap.get(item.date) ?? { ...ZERO_TOTALS }, piece))

    const mk = modelKey(item)
    let model = models.get(mk)
    if (!model) {
      model = {
        model: item.model,
        modelPermaslug: item.modelPermaslug,
        totals: { ...ZERO_TOTALS },
        providers: new Map()
      }
      models.set(mk, model)
    }
    model.totals = addTotals(model.totals, piece)
    const pk = providerKey(item)
    const existing = model.providers.get(pk)
    if (existing) {
      existing.totals = addTotals(existing.totals, piece)
    } else {
      model.providers.set(pk, {
        providerName: item.providerName,
        endpointId: item.endpointId,
        totals: piece
      })
    }
  }

  const daily: DailyBucket[] = window.dates.map((date) => ({
    date,
    totals: dailyMap.get(date) ?? { ...ZERO_TOTALS }
  }))

  const modelBuckets: ModelBucket[] = [...models.values()]
    .map((model) => ({
      model: model.model,
      modelPermaslug: model.modelPermaslug,
      totals: model.totals,
      providers: [...model.providers.values()].sort((a, b) => b.totals.usage - a.totals.usage)
    }))
    .sort((a, b) => b.totals.usage - a.totals.usage || a.model.localeCompare(b.model))

  return trimSnapshot({
    period,
    fetchedAt: fetchedAt.toISOString(),
    dataStartDate: window.start,
    dataEndDate: window.end,
    stale,
    cache,
    totals,
    daily,
    models: modelBuckets,
    modelsTruncated: false,
    empty: inWindow.length === 0
  })
}

export function trimSnapshot(
  snapshot: UsageSnapshot,
  maxBytes = PANEL_RESULT_SOFT_MAX_BYTES
): UsageSnapshot {
  let models = snapshot.models
  let truncated = snapshot.modelsTruncated
  while (models.length > 1 && jsonUtf8Bytes({ ...snapshot, models }) > maxBytes) {
    models = models.slice(0, Math.max(1, models.length - 1))
    truncated = true
  }
  return { ...snapshot, models, modelsTruncated: truncated }
}
