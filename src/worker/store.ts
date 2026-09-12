export type PluginStore = {
  secretsGet(key: string): Promise<string | null>
  secretsSet(key: string, value: string): Promise<void>
  secretsDelete(key: string): Promise<void>
  storageGet(key: string): Promise<unknown>
  storageSet(key: string, value: unknown): Promise<void>
  storageDelete(key: string): Promise<void>
  settingsGet(): Promise<Record<string, unknown>>
  settingsSet(key: string, value: unknown): Promise<void>
  notify?(title: string, body?: string): Promise<void>
  log(message: string): void
}

export type OrcaApi = {
  host: { call(method: string, params?: unknown): Promise<unknown> }
  log(message: string): void
}

export function createOrcaStore(orca: OrcaApi): PluginStore {
  return {
    async secretsGet(key) {
      const result = (await orca.host.call('secrets.get', { key })) as { value: string | null }
      return result.value
    },
    async secretsSet(key, value) {
      await orca.host.call('secrets.set', { key, value })
    },
    async secretsDelete(key) {
      await orca.host.call('secrets.delete', { key })
    },
    async storageGet(key) {
      const result = (await orca.host.call('storage.get', { key })) as { value: unknown }
      return result.value
    },
    async storageSet(key, value) {
      await orca.host.call('storage.set', { key, value })
    },
    async storageDelete(key) {
      await orca.host.call('storage.delete', { key })
    },
    async settingsGet() {
      const result = (await orca.host.call('settings.get', {})) as {
        settings: Record<string, unknown>
      }
      return result.settings ?? {}
    },
    async settingsSet(key, value) {
      await orca.host.call('settings.set', { key, value })
    },
    async notify(title, body) {
      await orca.host.call('notifications.show', { title, body })
    },
    log(message) {
      orca.log(message)
    }
  }
}

export function createMemoryStore(seed?: {
  secrets?: Record<string, string>
  storage?: Record<string, unknown>
  settings?: Record<string, unknown>
}): PluginStore & {
  secrets: Record<string, string>
  storage: Record<string, unknown>
  settings: Record<string, unknown>
  logs: string[]
} {
  const secrets = { ...(seed?.secrets ?? {}) }
  const storage = { ...(seed?.storage ?? {}) }
  const settings = { ...(seed?.settings ?? {}) }
  const logs: string[] = []
  return {
    secrets,
    storage,
    settings,
    logs,
    async secretsGet(key) {
      return secrets[key] ?? null
    },
    async secretsSet(key, value) {
      secrets[key] = value
    },
    async secretsDelete(key) {
      delete secrets[key]
    },
    async storageGet(key) {
      return storage[key] ?? null
    },
    async storageSet(key, value) {
      storage[key] = value
    },
    async storageDelete(key) {
      delete storage[key]
    },
    async settingsGet() {
      return { ...settings }
    },
    async settingsSet(key, value) {
      settings[key] = value
    },
    log(message) {
      logs.push(message)
    }
  }
}
