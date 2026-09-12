import {
  DEFAULT_CACHE_TTL_MS,
  PLUGIN_STORAGE_VALUE_MAX_BYTES,
  STORAGE_CACHE_KEY,
  type ActivityItem
} from '../shared/types.ts'
import { jsonUtf8Bytes } from '../shared/bytes.ts'
import type { PluginStore } from './store.ts'

export type CachedActivity = {
  fingerprint: string
  filterKey: string
  fetchedAt: number
  items: ActivityItem[]
}

export class ActivityCache {
  generation = 0
  memory: CachedActivity | null = null
  private inflight = new Map<string, Promise<unknown>>()

  constructor(
    private readonly store: PluginStore,
    private readonly ttlMs = DEFAULT_CACHE_TTL_MS,
    private readonly now: () => number = Date.now
  ) {}

  bumpGeneration(): void {
    this.generation += 1
    this.memory = null
    this.inflight.clear()
  }

  isFresh(entry: CachedActivity, fingerprint: string, filterKey: string): boolean {
    return (
      entry.fingerprint === fingerprint &&
      entry.filterKey === filterKey &&
      this.now() - entry.fetchedAt <= this.ttlMs
    )
  }

  isUsable(entry: CachedActivity, fingerprint: string, filterKey: string): boolean {
    return entry.fingerprint === fingerprint && entry.filterKey === filterKey
  }

  async loadPersisted(): Promise<CachedActivity | null> {
    const value = await this.store.storageGet(STORAGE_CACHE_KEY)
    if (!value || typeof value !== 'object') return null
    const record = value as Partial<CachedActivity>
    if (
      typeof record.fingerprint !== 'string' ||
      typeof record.filterKey !== 'string' ||
      typeof record.fetchedAt !== 'number' ||
      !Array.isArray(record.items)
    ) {
      return null
    }
    return record as CachedActivity
  }

  async persist(entry: CachedActivity): Promise<boolean> {
    if (jsonUtf8Bytes(entry) > PLUGIN_STORAGE_VALUE_MAX_BYTES) {
      return false
    }
    try {
      await this.store.storageSet(STORAGE_CACHE_KEY, entry)
      return true
    } catch {
      return false
    }
  }

  async clearPersisted(): Promise<void> {
    await this.store.storageDelete(STORAGE_CACHE_KEY)
  }

  remember(entry: CachedActivity): void {
    this.memory = entry
  }

  async dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key)
    if (existing) return existing as Promise<T>
    let settle!: (value: T) => void
    let fail!: (error: unknown) => void
    const pending = new Promise<T>((resolve, reject) => {
      settle = resolve
      fail = reject
    })
    this.inflight.set(key, pending)
    run().then(settle, fail).finally(() => {
      if (this.inflight.get(key) === pending) this.inflight.delete(key)
    })
    return pending
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
