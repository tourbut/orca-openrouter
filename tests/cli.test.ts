import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveOrcaCli, selectWorktree } from '../src/worker/cli.ts'

test('resolves orca-ide from HOME even when PATH is a typical Electron allowlist', () => {
  const cli = resolveOrcaCli({
    HOME: process.env.HOME,
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  })
  assert.match(cli, /orca-ide$/)
  assert.notEqual(cli, '/usr/bin/orca')
  assert.notEqual(cli, 'orca')
})

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
