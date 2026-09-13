import type { ConnectionStatus, PeriodDays, PluginError, UsageSnapshot } from '../shared/types.ts'
import { createPanelBridge, HostMissingError } from './bridge.ts'
import { renderPanel } from './render.ts'
import {
  applyConnection,
  applyError,
  applySnapshot,
  initialPanelState,
  type PanelState
} from './state.ts'

const mount = document.getElementById('app')
if (!mount) throw new Error('missing #app')
const root: HTMLElement = mount

const bridge = createPanelBridge()
let state: PanelState = initialPanelState()

function paint(): void {
  renderPanel(root, state, {
    refresh: () => void loadUsage(true),
    setPeriod: (period) => void changePeriod(period),
    toggleSettings: () => {
      state = { ...state, settingsOpen: !state.settingsOpen }
      paint()
    },
    saveKey: (apiKey) => void saveKey(apiKey),
    disconnect: () => void disconnect(),
    toggleModel: (key) => {
      state = { ...state, expandedModel: state.expandedModel === key ? null : key }
      paint()
    }
  })
}

function readError(error: unknown): PluginError {
  if (error instanceof HostMissingError) {
    return { code: 'host_missing', message: error.message, retryable: false }
  }
  const err = error as { code?: string; message?: string; value?: UsageSnapshot }
  const code = (err.code as PluginError['code'] | undefined) ?? 'unavailable'
  return {
    code,
    message: err.message || 'Request failed',
    retryable: code === 'network' || code === 'timeout' || code === 'rate_limited'
  }
}

async function loadUsage(forceRefresh = false): Promise<void> {
  state = { ...state, view: { kind: 'loading', period: state.period }, statusNote: null }
  paint()
  try {
    const snapshot = (await bridge.request('usage.query', {
      period: state.period,
      forceRefresh
    })) as UsageSnapshot
    state = applySnapshot(state, snapshot)
  } catch (error) {
    const pluginError = readError(error)
    const snapshot = (error as { value?: UsageSnapshot }).value
    state = applyError(state, pluginError, snapshot)
  }
  paint()
}

async function changePeriod(period: PeriodDays): Promise<void> {
  state = { ...state, period }
  try {
    await bridge.request('preferences.update', { period })
  } catch {
    // Keep the local filter even if settings persist is unavailable.
  }
  await loadUsage(false)
}

async function saveKey(apiKey: string): Promise<void> {
  try {
    const status = (await bridge.request('connection.save', { apiKey })) as ConnectionStatus
    state = applyConnection(state, status)
    paint()
    if (status.connected) await loadUsage(true)
  } catch (error) {
    state = applyError(state, readError(error))
    paint()
  }
}

async function disconnect(): Promise<void> {
  await bridge.request('connection.remove')
  state = applyConnection(state, { connected: false })
  paint()
}

async function boot(): Promise<void> {
  paint()
  const available = await bridge.probe()
  if (!available) {
    state = { ...state, view: { kind: 'host_missing' }, settingsOpen: false }
    paint()
    return
  }
  try {
    const status = (await bridge.request('connection.status')) as ConnectionStatus
    state = applyConnection(state, status)
    paint()
    if (status.connected) await loadUsage(false)
  } catch (error) {
    if (error instanceof HostMissingError) {
      state = { ...state, view: { kind: 'host_missing' } }
    } else {
      state = applyError(state, readError(error))
    }
    paint()
  }
}

void boot()
