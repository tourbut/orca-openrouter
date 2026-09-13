import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
mkdirSync(dist, { recursive: true })

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src/worker/main.ts')],
  outfile: join(dist, 'main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none'
})

writeFileSync(join(dist, 'panel.html'), readFileSync(join(root, 'src/panel/index.html'), 'utf8'))

const dashboard = await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src/web/main.ts')],
  outfile: join(dist, 'dashboard.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  legalComments: 'none'
})
void dashboard

const css = readFileSync(join(root, 'src/panel/styles.css'), 'utf8')
const html = readFileSync(join(root, 'src/web/index.html'), 'utf8').replace('/*__DASHBOARD_CSS__*/', css)
writeFileSync(join(dist, 'dashboard.html'), html)
console.log('wrote dist/main.mjs, dist/panel.html, dist/dashboard.html, dist/dashboard.js')
