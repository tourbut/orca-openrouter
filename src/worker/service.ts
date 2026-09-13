import {
  DEFAULT_FETCH_TIMEOUT_MS,
  SECRET_KEY,
  SETTINGS_PERIOD_KEY,
  type ConnectionStatus,
  type MethodName,
  type MethodResult,
  type PeriodDays,
  type PluginError,
  type PreferencesUpdate,
  type QueryRequest,
  type UsageSnapshot
} from '../shared/types.ts'
import {
  parsePreferencesUpdate,
  parseQueryRequest,
  parseSaveConnectionRequest
} from '../shared/methods.ts'
import { parsePeriod } from '../shared/methods.ts'
import { redactSecrets } from '../shared/redact.ts'
import { aggregateActivity } from './aggregate.ts'
import { ActivityCache, sha256Hex, type CachedActivity } from './cache.ts'
import { fetchActivity, type FetchImpl } from './openrouter.ts'
import type { PluginStore } from './store.ts'

export type UsageServiceOptions = {
  store: PluginStore
  fetchImpl: FetchImpl
  now?: () => Date
  timeoutMs?: number
  ttlMs?: number
}

function fail<T>(error: PluginError, snapshot?: UsageSnapshot): MethodResult<T> {
  return snapshot ? { ok: false, error, snapshot } : { ok: false, error }
}

function ok<T>(value: T): MethodResult<T> {
  return { ok: true, value }
}

export class UsageService {
  private readonly cache: ActivityCache
  private readonly now: () => Date
  private readonly timeoutMs: number

  constructor(private readonly options: UsageServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
    this.cache = new ActivityCache(options.store, options.ttlMs, () => this.now().getTime())
  }

  async dispatch(method: MethodName, params: unknown): Promise<MethodResult<unknown>> {
    switch (method) {
      case 'connection.status':
        return ok(await this.connectionStatus())
      case 'connection.save':
        return this.saveConnection(params)
      case 'connection.remove':
        return this.removeConnection()
      case 'usage.query':
        return this.query(params)
      case 'preferences.update':
        return this.updatePreferences(params)
    }
  }

  async connectionStatus(): Promise<ConnectionStatus> {
    const key = await this.options.store.secretsGet(SECRET_KEY)
    return { connected: typeof key === 'string' && key.length > 0 }
  }

  async saveConnection(params: unknown): Promise<MethodResult<ConnectionStatus>> {
    const parsed = parseSaveConnectionRequest(params)
    if ('error' in parsed) {
      return fail({ code: 'invalid_params', message: parsed.error, retryable: false })
    }
    const generation = this.cache.generation
    const fetched = await fetchActivity({
      apiKey: parsed.apiKey,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.options.fetchImpl,
      now: () => this.now().getTime()
    })
    if (generation !== this.cache.generation) {
      return fail({ code: 'discarded', message: 'Connection changed during verification.', retryable: true })
    }
    if (!fetched.ok) return fail(fetched.error)

    try {
      await this.options.store.secretsSet(SECRET_KEY, parsed.apiKey)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to store secret'
      return fail({
        code: 'unavailable',
        message: redactSecrets(message),
        retryable: false
      })
    }

    // Disconnect or another key replacement may have started while the
    // verification request was in flight. Do not resurrect that connection.
    if (generation !== this.cache.generation) {
      const current = await this.options.store.secretsGet(SECRET_KEY)
      if (current === parsed.apiKey) await this.options.store.secretsDelete(SECRET_KEY)
      return fail({ code: 'discarded', message: 'Connection changed during verification.', retryable: true })
    }

    this.cache.bumpGeneration()
    await this.cache.clearPersisted()
    const fingerprint = await sha256Hex(parsed.apiKey)
    const entry: CachedActivity = {
      fingerprint,
      filterKey: 'account',
      fetchedAt: this.now().getTime(),
      items: fetched.items
    }
    this.cache.remember(entry)
    await this.cache.persist(entry)
    this.options.store.log('management key verified and stored')
    return ok({ connected: true })
  }

  async removeConnection(): Promise<MethodResult<ConnectionStatus>> {
    this.cache.bumpGeneration()
    await this.options.store.secretsDelete(SECRET_KEY)
    await this.cache.clearPersisted()
    return ok({ connected: false })
  }

  async updatePreferences(params: unknown): Promise<MethodResult<{ period: PeriodDays }>> {
    const parsed = parsePreferencesUpdate(params)
    if ('error' in parsed) {
      return fail({ code: 'invalid_params', message: parsed.error, retryable: false })
    }
    const period = parsed.period ?? (await this.readPeriod())
    await this.options.store.settingsSet(SETTINGS_PERIOD_KEY, period)
    return ok({ period })
  }

  async query(params: unknown): Promise<MethodResult<UsageSnapshot>> {
    const parsed = parseQueryRequest(params)
    if ('error' in parsed) {
      return fail({ code: 'invalid_params', message: parsed.error, retryable: false })
    }
    const period = parsed.period ?? (await this.readPeriod())
    const forceRefresh = parsed.forceRefresh === true
    const filterKey = 'account'
    if (!forceRefresh && this.cache.memory && this.cache.isFresh(this.cache.memory, this.cache.memory.fingerprint, filterKey)) {
      return ok(this.snapshotFromCache(this.cache.memory, period, 'fresh', false))
    }

    // Dedupe the HTTP request only for callers requesting the same period;
    // the returned snapshot is period-specific.
    return this.cache.dedupe(`account:${this.cache.generation}:${period}`, async () => {
      const apiKey = await this.options.store.secretsGet(SECRET_KEY)
      if (!apiKey) {
        return fail<UsageSnapshot>({
          code: 'not_connected',
          message: 'No management key is stored.',
          retryable: false
        })
      }
      const fingerprint = await sha256Hex(apiKey)
      if (!forceRefresh) {
        const cached = await this.resolveCached(fingerprint, filterKey)
        if (cached && this.cache.isFresh(cached, fingerprint, filterKey)) {
          return ok(this.snapshotFromCache(cached, period, 'fresh', false))
        }
      }
      const generation = this.cache.generation
      const fetched = await fetchActivity({
        apiKey,
        timeoutMs: this.timeoutMs,
        fetchImpl: this.options.fetchImpl,
        now: () => this.now().getTime()
      })
      if (generation !== this.cache.generation) {
        return fail<UsageSnapshot>({
          code: 'discarded',
          message: 'A newer connection replaced this request.',
          retryable: true
        })
      }
      if (!fetched.ok) {
        const previous = await this.resolveCached(fingerprint, filterKey)
        const snapshot = previous
          ? this.snapshotFromCache(previous, period, 'stale', true)
          : undefined
        return fail<UsageSnapshot>(fetched.error, snapshot)
      }
      const entry: CachedActivity = {
        fingerprint,
        filterKey,
        fetchedAt: this.now().getTime(),
        items: fetched.items
      }
      this.cache.remember(entry)
      await this.cache.persist(entry)
      return ok(this.snapshotFromCache(entry, period, 'fresh', false))
    })
  }

  private async resolveCached(fingerprint: string, filterKey: string): Promise<CachedActivity | null> {
    if (this.cache.memory && this.cache.isUsable(this.cache.memory, fingerprint, filterKey)) {
      return this.cache.memory
    }
    const persisted = await this.cache.loadPersisted()
    if (persisted && this.cache.isUsable(persisted, fingerprint, filterKey)) {
      this.cache.remember(persisted)
      return persisted
    }
    return null
  }

  private snapshotFromCache(
    entry: CachedActivity,
    period: PeriodDays,
    cache: UsageSnapshot['cache'],
    stale: boolean
  ): UsageSnapshot {
    return aggregateActivity(entry.items, period, this.now(), new Date(entry.fetchedAt), cache, stale)
  }

  private async readPeriod(): Promise<PeriodDays> {
    const settings = await this.options.store.settingsGet()
    return parsePeriod(settings[SETTINGS_PERIOD_KEY]) ?? 7
  }

  async hydrateFromStorage(apiKey: string | null): Promise<void> {
    if (!apiKey) return
    const persisted = await this.cache.loadPersisted()
    if (!persisted) return
    const fingerprint = await sha256Hex(apiKey)
    if (this.cache.isUsable(persisted, fingerprint, persisted.filterKey)) {
      this.cache.remember(persisted)
    }
  }
}

export function formatNotificationSummary(snapshot: UsageSnapshot): string {
  const usage = snapshot.totals.usage.toFixed(4)
  return `UTC ${snapshot.dataStartDate}–${snapshot.dataEndDate}: $${usage}, ${snapshot.totals.requests} requests`
}
