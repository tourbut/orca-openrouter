import type { DailyBucket, ModelBucket, UsageSnapshot } from '../shared/types.ts'
import { formatCount, formatTotals, formatUsd } from './format.ts'
import { modelRowKey, type PanelState } from './state.ts'

export type PanelHandlers = {
  refresh(): void
  setPeriod(period: 7 | 30): void
  toggleSettings(): void
  saveKey(apiKey: string): void
  disconnect(): void
  toggleModel(key: string): void
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value
    else node.setAttribute(key, value)
  }
  for (const child of children) {
    node.append(child)
  }
  return node
}

function metric(label: string, value: string): HTMLElement {
  return el('div', { class: 'metric' }, [
    el('div', { class: 'metric-label' }, [label]),
    el('div', { class: 'metric-value' }, [value])
  ])
}

function chartSvg(daily: DailyBucket[]): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 300 84')
  svg.setAttribute('class', 'chart')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'Daily usage cost')
  const max = Math.max(0, ...daily.map((day) => day.totals.usage))
  const n = daily.length || 1
  const gap = 2
  const width = (300 - gap * (n + 1)) / n
  daily.forEach((day, index) => {
    const height = max > 0 ? (day.totals.usage / max) * 68 : 0
    const x = gap + index * (width + gap)
    const y = 72 - height
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(x))
    rect.setAttribute('y', String(y))
    rect.setAttribute('width', String(Math.max(width, 1)))
    rect.setAttribute('height', String(Math.max(height, max === 0 ? 0 : 1)))
    rect.setAttribute('rx', '1.5')
    rect.setAttribute('class', 'bar')
    rect.setAttribute('data-date', day.date)
    svg.appendChild(rect)
  })
  return svg
}

function hostMissing(): HTMLElement {
  return el('div', { class: 'banner warning' }, [
    el('strong', {}, ['Host bridge required']),
    el(
      'p',
      {},
      [
        'Installed Orca 1.4.198 lets this panel call workspace/terminal/notification host actions only. There is no public panel-to-worker request API, and CSP blocks direct HTTP from the panel. Core aggregation, cache, and Activity API access are implemented in the worker and verified by tests. Apply host-patch/ to Orca, or use npm run preview / npm run verify:api.'
      ]
    )
  ])
}

function snapshotBody(snapshot: UsageSnapshot, state: PanelState, handlers: PanelHandlers): HTMLElement {
  const totals = formatTotals(snapshot.totals)
  const wrap = el('div', { class: 'stack' })
  wrap.append(
    el('div', { class: 'metrics' }, [
      metric('Usage cost', totals.usage),
      metric('Requests', totals.requests),
      metric('Prompt tokens', totals.prompt),
      metric('Completion tokens', totals.completion),
      metric('Reasoning tokens', totals.reasoning),
      metric('BYOK inference', totals.byok)
    ]),
    el('div', { class: 'section' }, [
      el('h2', {}, ['Daily usage cost']),
      chartSvg(snapshot.daily)
    ])
  )

  const list = el('div', { class: 'section' }, [el('h2', {}, ['Models'])])
  if (snapshot.models.length === 0) {
    list.append(el('p', { class: 'muted' }, ['No completed activity in this UTC window.']))
  }
  for (const model of snapshot.models) {
    list.append(modelRow(model, state, handlers))
  }
  if (snapshot.modelsTruncated) {
    list.append(el('p', { class: 'muted' }, ['Additional models were omitted to fit the panel payload limit.']))
  }
  wrap.append(list)
  wrap.append(
    el('p', { class: 'footer' }, [
      `Last fetch: ${snapshot.fetchedAt} · Data ${snapshot.dataStartDate} to ${snapshot.dataEndDate} UTC · cache ${snapshot.cache}${snapshot.stale ? ' (stale)' : ''}`
    ])
  )
  return wrap
}

function modelRow(model: ModelBucket, state: PanelState, handlers: PanelHandlers): HTMLElement {
  const key = modelRowKey(model.model, model.modelPermaslug)
  const open = state.expandedModel === key
  const totals = formatTotals(model.totals)
  const row = el('div', { class: 'model' })
  const button = el('button', { class: 'model-toggle', type: 'button' }, [
    el('div', { class: 'model-name' }, [
      el('div', {}, [model.model]),
      el('div', { class: 'muted' }, [model.modelPermaslug])
    ]),
    el('div', { class: 'model-stats' }, [`${totals.usage} · ${totals.requests}`])
  ])
  button.addEventListener('click', () => handlers.toggleModel(key))
  row.append(button)
  if (open) {
    const detail = el('div', { class: 'providers' })
    for (const provider of model.providers) {
      detail.append(
        el('div', { class: 'provider' }, [
          el('div', {}, [`${provider.providerName}`]),
          el('div', { class: 'muted' }, [
            `${formatUsd(provider.totals.usage)} · ${formatCount(provider.totals.requests)} · ${provider.endpointId}`
          ])
        ])
      )
    }
    row.append(detail)
  }
  return row
}

export function renderPanel(root: HTMLElement, state: PanelState, handlers: PanelHandlers): void {
  root.replaceChildren()
  const header = el('header', { class: 'header' }, [
    el('h1', {}, ['OpenRouter Usage']),
    el('button', { class: 'ghost', type: 'button', id: 'settings' }, ['Settings'])
  ])
  header.querySelector('#settings')?.addEventListener('click', () => handlers.toggleSettings())

  const toolbar = el('div', { class: 'toolbar' }, [
    el('label', { class: 'sr-only' }, ['Completed UTC days']),
    periodSelect(state, handlers),
    el('button', { class: 'primary', type: 'button', id: 'refresh' }, ['Refresh'])
  ])
  toolbar.querySelector('#refresh')?.addEventListener('click', () => handlers.refresh())

  root.append(header, toolbar, el('p', { class: 'hint' }, ['UTC · today excluded · BYOK and reasoning are shown separately']))

  if (state.statusNote) {
    root.append(el('div', { class: 'banner' }, [state.statusNote]))
  }

  if (state.view.kind === 'probing') {
    root.append(el('p', { class: 'muted' }, ['Checking host bridge…']))
  } else if (state.view.kind === 'host_missing') {
    root.append(hostMissing())
  } else if (state.view.kind === 'needs_key') {
    root.append(el('p', { class: 'muted' }, ['Store a management key to load completed Activity data.']))
  } else if (state.view.kind === 'loading') {
    root.append(el('p', { class: 'muted' }, ['Loading activity…']))
  } else if (state.view.kind === 'ready') {
    root.append(snapshotBody(state.view.snapshot, state, handlers))
  } else if (state.view.kind === 'error') {
    root.append(el('div', { class: 'banner error' }, [state.view.error.message]))
    if (state.view.snapshot) root.append(snapshotBody(state.view.snapshot, state, handlers))
  }

  if (state.settingsOpen && state.view.kind !== 'host_missing') {
    root.append(settingsForm(handlers, state.view.kind !== 'needs_key'))
  }
}

function periodSelect(state: PanelState, handlers: PanelHandlers): HTMLSelectElement {
  const select = el('select', { 'aria-label': 'Completed UTC days' }) as HTMLSelectElement
  for (const days of [7, 30] as const) {
    const option = el('option', { value: String(days) }, [`Last completed ${days} days`]) as HTMLOptionElement
    option.selected = state.period === days
    select.append(option)
  }
  select.addEventListener('change', () => {
    handlers.setPeriod(select.value === '30' ? 30 : 7)
  })
  return select
}

function settingsForm(handlers: PanelHandlers, connected: boolean): HTMLElement {
  const form = el('form', { class: 'settings' })
  form.append(
    el('h2', {}, ['Management key']),
    el('p', { class: 'muted' }, [
      'The key is stored in the Orca secret vault. The panel never reads it back.'
    ]),
    el('input', {
      type: 'password',
      name: 'apiKey',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'sk-or-v1-…'
    }),
    el('div', { class: 'row' }, [
      el('button', { class: 'primary', type: 'button', id: 'save-key' }, ['Save and verify']),
      ...(connected
        ? [el('button', { class: 'ghost', type: 'button', id: 'disconnect' }, ['Disconnect'])]
        : [])
    ])
  )
  form.querySelector('#save-key')?.addEventListener('click', () => {
    const input = form.querySelector('input[name="apiKey"]') as HTMLInputElement
    const value = input.value
    input.value = ''
    handlers.saveKey(value)
  })
  form.querySelector('#disconnect')?.addEventListener('click', () => handlers.disconnect())
  return form
}
