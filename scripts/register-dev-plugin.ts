import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dataPath = resolve(
  process.env.HOME ?? '',
  '.config/orca/profiles/local-default/orca-data.json'
)
const pluginRoot = resolve(process.cwd())
const qualifiedKey = 'tourbut.openrouter-usage'

function canonicalizeCapabilitySet(capabilities: Array<Record<string, string>>): string {
  const encoded = capabilities.map((capability) =>
    JSON.stringify(Object.fromEntries(Object.entries(capability).sort(([a], [b]) => a.localeCompare(b))))
  )
  return JSON.stringify([...new Set(encoded)].sort())
}

const fingerprint = `sha256-${createHash('sha256')
  .update(
    `${canonicalizeCapabilitySet([
      { kind: 'notifications:show' },
      { kind: 'secrets' },
      { kind: 'settings:own' },
      { kind: 'storage' }
    ])}\0trusted-node-worker`
  )
  .digest('base64')}`

const data = JSON.parse(readFileSync(dataPath, 'utf8')) as {
  settings?: Record<string, unknown>
}
data.settings = data.settings ?? {}
data.settings.pluginSystemEnabled = true
const paths = Array.isArray(data.settings.devPluginPaths)
  ? [...(data.settings.devPluginPaths as string[])]
  : []
if (!paths.includes(pluginRoot)) paths.push(pluginRoot)
data.settings.devPluginPaths = paths
const consents =
  typeof data.settings.pluginConsents === 'object' && data.settings.pluginConsents
    ? { ...(data.settings.pluginConsents as Record<string, string>) }
    : {}
consents[qualifiedKey] = fingerprint
data.settings.pluginConsents = consents
writeFileSync(dataPath, JSON.stringify(data))
console.log(
  JSON.stringify({
    wrote: dataPath,
    pluginSystemEnabled: true,
    devPluginPath: pluginRoot,
    qualifiedKey,
    fingerprintPrefix: fingerprint.slice(0, 12),
    note: 'Orca 1.4.198 serve host has no AT-SPI settings UI. This writes Development path + consent into the host settings store. A running in-memory store may need a Plugins toggle in the GUI to refresh.'
  })
)
