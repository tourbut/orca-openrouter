import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveOrcaCli, selectWorktree } from '../src/worker/cli.ts'

test('resolves orca-ide from HOME even when PATH is a typical Electron allowlist', () => {
  const cli = resolveOrcaCli({
    HOME: '/home/test',
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  }, { platform: 'linux', execPath: '/usr/bin/node', exists: (path) => path === '/home/test/.local/bin/orca-ide' })
  assert.match(cli, /orca-ide$/)
  assert.notEqual(cli, '/usr/bin/orca')
  assert.notEqual(cli, 'orca')
})

for (const [platform, execPath, expected] of [
  ['darwin', '/Applications/Orca.app/Contents/MacOS/Orca', '/Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/cli/index.js'],
  ['win32', 'C:\\Users\\Test User\\Orca\\Orca.exe', 'C:\\Users\\Test User\\Orca\\resources\\app.asar.unpacked\\out\\cli\\index.js'],
  ['linux', '/opt/Orca/orca-ide', '/opt/Orca/resources/app.asar.unpacked/out/cli/index.js']
] as const) {
  test(`finds the bundled CLI on ${platform} without PATH or shell registration`, () => {
    assert.equal(resolveOrcaCli({ PATH: '' }, {
      platform, execPath, exists: (path) => path === expected
    }), expected)
  })
}

test('selectWorktree prefers the plugin root path over an unrelated active worktree', () => {
  const hit = selectWorktree(
    [
      { id: 'other', path: '/tmp/other', isActive: true },
      {
        id: 'dev',
        path: '/home/shin/orca/workspaces/orca-openrouter/dev',
        isActive: false
      }
    ],
    '/home/shin/orca/workspaces/orca-openrouter/dev'
  )
  assert.equal(hit?.id, 'dev')
  assert.equal(hit?.selector, 'path:/home/shin/orca/workspaces/orca-openrouter/dev')
})
