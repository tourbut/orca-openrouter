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

const panel = await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src/panel/main.ts')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  write: false,
  legalComments: 'none'
})

const js = panel.outputFiles[0]?.text ?? ''
const css = readFileSync(join(root, 'src/panel/styles.css'), 'utf8')
const html = readFileSync(join(root, 'src/panel/index.html'), 'utf8')
  .replace('/*__PANEL_CSS__*/', css)
  .replace('/*__PANEL_JS__*/', js)

writeFileSync(join(dist, 'panel.html'), html)
console.log('wrote dist/main.mjs and dist/panel.html')
