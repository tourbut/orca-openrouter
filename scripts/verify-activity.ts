import { loadEnvFile } from './load-env.ts'
import { fetchActivity } from '../src/worker/openrouter.ts'
import { aggregateActivity } from '../src/worker/aggregate.ts'
import { completedUtcWindow } from '../src/shared/utc.ts'
import { redactSecrets } from '../src/shared/redact.ts'

const loaded = loadEnvFile()
const keyName = 'OPENROUTER_MANAGEMENT_KEY'
const apiKey = process.env[keyName]

console.log('dotenv keys loaded:', loaded.join(', ') || '(none)')
console.log('using variable:', keyName)
console.log('key present:', Boolean(apiKey && apiKey.length > 0))
console.log('key length:', apiKey ? apiKey.length : 0)

if (!apiKey) {
  console.error('missing OPENROUTER_MANAGEMENT_KEY; fixture tests can still run')
  process.exit(2)
}

const now = new Date()
const window = completedUtcWindow(now, 30)
const result = await fetchActivity({
  apiKey,
  timeoutMs: 10_000,
  fetchImpl: globalThis.fetch.bind(globalThis)
})

if (!result.ok) {
  console.log('activity GET status: failed')
  console.log('error code:', result.error.code)
  console.log('retryable:', result.error.retryable)
  console.log('message:', redactSecrets(result.error.message))
  if (result.error.code === 'forbidden') {
    console.log(
      'note: 403 means this key is not a management key (or lacks Activity permission). Fixture tests and worker implementation continue.'
    )
    process.exit(0)
  }
  process.exit(1)
}

const snapshot = aggregateActivity(result.items, 30, now, now, 'none', false)
const dates = result.items.map((item) => item.date).sort()
console.log('activity GET status: 200')
console.log('item count:', result.items.length)
console.log('utc window:', `${window.start} .. ${window.end}`)
console.log('response date min:', dates[0] ?? '(empty)')
console.log('response date max:', dates[dates.length - 1] ?? '(empty)')
console.log('empty:', snapshot.empty)
console.log('totals.usage:', snapshot.totals.usage)
console.log('totals.requests:', snapshot.totals.requests)
console.log('totals.promptTokens:', snapshot.totals.promptTokens)
console.log('totals.completionTokens:', snapshot.totals.completionTokens)
console.log('totals.reasoningTokens:', snapshot.totals.reasoningTokens)
console.log('totals.byokUsageInference:', snapshot.totals.byokUsageInference)
console.log('model count:', snapshot.models.length)
console.log('today excluded:', !result.items.some((item) => item.date === now.toISOString().slice(0, 10)))
