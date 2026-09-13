import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const skip = new Set(['node_modules', '.git'])
const pattern = /sk-or-v1-[A-Za-z0-9_-]{8,}|OPENROUTER_MANAGEMENT_KEY=.+/
const hits = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue
    const path = join(dir, name)
    const st = statSync(path)
    if (st.isDirectory()) walk(path)
    else if (st.isFile()) {
      const text = readFileSync(path, 'utf8')
      if (name === '.env') continue
      if (pattern.test(text) && !path.endsWith('secret-scan.mjs') && !path.endsWith('.example')) {
        const lines = text.split('\n')
        lines.forEach((line, i) => {
          if (/sk-or-v1-[A-Za-z0-9_-]{16,}/.test(line) && !line.includes('sk-or-v1-old') && !line.includes('sk-or-v1-new') && !line.includes('sk-or-v1-live') && !line.includes('sk-or-v1-test') && !line.includes('sk-or-v1-secretvalue') && !line.includes('sk-or-v1-abcdef') && !line.includes('sk-or-v1-supersecret') && !line.includes('placeholder')) {
            hits.push(`${path}:${i + 1}`)
          }
        })
      }
    }
  }
}

walk(root)
if (hits.length) {
  console.error('secret scan failed:', hits)
  process.exit(1)
}
console.log('secret scan ok')
