import type { ConnectionStatus, PeriodDays, PluginError, UsageSnapshot } from '../shared/types.ts'
import { isCurrentGeneration, nextGeneration } from '../shared/generation.ts'
import { renderPanel } from '../panel/render.ts'
import {
  applyConnection,
  applyError,
  applySnapshot,
  initialPanelState,
  type PanelState
} from '../panel/state.ts'

const mount = document.getElementById('app')
if (!mount) throw new Error('missing #app')
const root: HTMLElement = mount

let sessionToken = ''
let state: PanelState = initialPanelState()
let queryGeneration = 0

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

type ApiResult = { ok: boolean; value?: unknown; error?: string; errorCode?: string }

async function api(path: string, body: unknown = {}): Promise<ApiResult> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {})
    },
    body: JSON.stringify(body)
  })
  return (await response.json()) as ApiResult
}

function asError(result: ApiResult): PluginError {
  return {
    code: (result.errorCode as PluginError['code'] | undefined) ?? 'unavailable',
    message: result.error || 'Request failed',
    retryable:
      result.errorCode === 'network' ||
      result.errorCode === 'timeout' ||
      result.errorCode === 'rate_limited'
  }
}

async function loadUsage(forceRefresh = false): Promise<void> {
  const generation = nextGeneration(queryGeneration)
  queryGeneration = generation
  state = { ...state, view: { kind: 'loading', period: state.period }, statusNote: null }
  paint()
  const result = await api('/api/usage/query', { period: state.period, forceRefresh })
  if (!isCurrentGeneration(generation, queryGeneration)) return
  if (result.ok) {
    state = applySnapshot(state, result.value as UsageSnapshot)
  } else {
    state = applyError(state, asError(result), result.value as UsageSnapshot | undefined)
  }
  paint()
}

async function changePeriod(period: PeriodDays): Promise<void> {
  queryGeneration = nextGeneration(queryGeneration)
  state = { ...state, period }
  await api('/api/preferences', { period }).catch(() => undefined)
  await loadUsage(false)
}

async function saveKey(apiKey: string): Promise<void> {
  const result = await api('/api/connection/save', { apiKey })
  if (!result.ok) {
    state = applyError(state, asError(result))
    paint()
    return
  }
  state = applyConnection(state, result.value as ConnectionStatus)
  paint()
  if ((result.value as ConnectionStatus).connected) await loadUsage(true)
}

async function disconnect(): Promise<void> {
  queryGeneration = nextGeneration(queryGeneration)
  await api('/api/connection/remove')
  state = applyConnection(state, { connected: false })
  paint()
}

async function boot(): Promise<void> {
  paint()
  const params = new URLSearchParams(location.search)
  const entryToken = params.get('entry') ?? ''
  history.replaceState({}, '', '/')
  const exchanged = await api('/api/session/exchange', { entryToken })
  if (!exchanged.ok) {
    state = applyError(state, {
      code: 'auth_failed',
      message: 'This dashboard link expired. Run OpenRouter: Open Dashboard again.',
      retryable: false
    })
    paint()
    return
  }
  sessionToken = String((exchanged.value as { sessionToken?: string }).sessionToken ?? '')
  const status = await api('/api/connection/status')
  if (!status.ok) {
    state = applyError(state, asError(status))
    paint()
    return
  }
  state = applyConnection(state, status.value as ConnectionStatus)
  paint()
  if ((status.value as ConnectionStatus).connected) await loadUsage(false)
}

void boot()
