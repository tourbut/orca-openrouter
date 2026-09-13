import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { redactSecrets } from '../shared/redact.ts'

export type CliResult = {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

const GNOME_ORCA = '/usr/bin/orca'

export function resolveOrcaCli(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || homedir()
  const pathDirs = (env.PATH ?? '').split(delimiter).filter(Boolean)
  const named: string[] = []
  for (const dir of pathDirs) {
    named.push(join(dir, 'orca-ide'), join(dir, 'orca-dev'))
  }
  const candidates = [
    env.ORCA_CLI_COMMAND,
    ...named,
    join(home, '.local/bin/orca-ide'),
    join(home, '.local/opt/orca/squashfs-root/resources/bin/orca-ide')
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)

  for (const candidate of candidates) {
    if (candidate === 'orca' || candidate === GNOME_ORCA) continue
    if (existsSync(candidate)) return candidate
  }
  throw new Error('Could not find the Orca CLI (orca-ide). It is not on the plugin worker PATH.')
}

export function runOrcaCli(
  cli: string,
  args: string[],
  options?: { timeoutMs?: number; cwd?: string }
): Promise<CliResult> {
  if (cli === 'orca' || cli === GNOME_ORCA) {
    return Promise.reject(new Error('refusing to invoke the GNOME Orca screen reader'))
  }
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, {
      cwd: options?.cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const chunks: Buffer[] = []
    const err: Buffer[] = []
    child.stdout?.on('data', (d) => chunks.push(d as Buffer))
    child.stderr?.on('data', (d) => err.push(d as Buffer))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`orca CLI timed out: ${args[0] ?? ''}`))
    }, options?.timeoutMs ?? 15_000)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        code,
        stdout: Buffer.concat(chunks).toString('utf8'),
        stderr: redactSecrets(Buffer.concat(err).toString('utf8'))
      })
    })
  })
}

export function parseCliJson(stdout: string): unknown {
  const start = stdout.indexOf('{')
  if (start < 0) throw new Error('orca CLI did not return JSON')
  return JSON.parse(stdout.slice(start))
}

export type WorktreeHit = {
  id: string
  path: string
  selector: string
}

export function selectWorktree(
  worktrees: Array<{ id?: string; path?: string; isActive?: boolean; displayName?: string }>,
  pluginRoot: string
): WorktreeHit | null {
  const normalized = pluginRoot.replace(/\/+$/, '')
  const byPath = worktrees.find((wt) => {
    const path = (wt.path ?? '').replace(/\/+$/, '')
    return path && (normalized === path || normalized.startsWith(`${path}/`))
  })
  const hit = byPath ?? worktrees.find((wt) => wt.isActive) ?? worktrees[0]
  if (!hit?.path || !hit.id) return null
  return { id: hit.id, path: hit.path, selector: `path:${hit.path}` }
}
