import type { ConnectionStatus, PeriodDays, PluginError, UsageSnapshot } from '../shared/types.ts'

export type PanelView =
  | { kind: 'probing' }
  | { kind: 'host_missing' }
  | { kind: 'needs_key' }
  | { kind: 'loading'; period: PeriodDays }
  | { kind: 'ready'; snapshot: UsageSnapshot }
  | { kind: 'error'; error: PluginError; snapshot?: UsageSnapshot; period: PeriodDays }

export type PanelState = {
  view: PanelView
  period: PeriodDays
  settingsOpen: boolean
  expandedModel: string | null
  statusNote: string | null
}

export const initialPanelState = (): PanelState => ({
  view: { kind: 'probing' },
  period: 7,
  settingsOpen: false,
  expandedModel: null,
  statusNote: null
})

export function modelRowKey(model: string, permaslug: string): string {
  return `${model}::${permaslug}`
}

export function applyConnection(state: PanelState, status: ConnectionStatus): PanelState {
  if (!status.connected) {
    return { ...state, view: { kind: 'needs_key' }, settingsOpen: true }
  }
  return { ...state, view: { kind: 'loading', period: state.period }, settingsOpen: false }
}

export function applySnapshot(state: PanelState, snapshot: UsageSnapshot): PanelState {
  return {
    ...state,
    period: snapshot.period,
    view: { kind: 'ready', snapshot },
    statusNote: snapshot.stale ? 'Showing cached data' : null
  }
}

export function applyError(
  state: PanelState,
  error: PluginError,
  snapshot?: UsageSnapshot
): PanelState {
  if (error.code === 'not_connected') {
    return { ...state, view: { kind: 'needs_key' }, settingsOpen: true, statusNote: error.message }
  }
  return {
    ...state,
    view: { kind: 'error', error, snapshot, period: state.period },
    statusNote: error.message
  }
}
