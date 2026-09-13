import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCliJson, resolveOrcaCli, runOrcaCli, selectWorktree } from './cli.ts'
import { DashboardServer } from './dashboard-server.ts'
import type { UsageService } from './service.ts'
import type { OrcaApi } from './store.ts'

export function pluginRootFromModuleUrl(moduleUrl: string): string {
  return dirname(fileURLToPath(new URL('.', moduleUrl)))
}

export type OpenDashboardResult = {
  ok: boolean
  origin?: string
  reused?: boolean
  worktree?: string
  error?: string
}

export class DashboardRuntime {
  private server: DashboardServer | null = null
  private cli: string | null = null

  constructor(
    private readonly orca: OrcaApi,
    private readonly service: UsageService,
    private readonly pluginRoot: string
  ) {}

  async open(): Promise<OpenDashboardResult> {
    try {
      this.cli = this.cli ?? resolveOrcaCli()
      if (!this.server) {
        this.server = new DashboardServer({
          pluginRoot: this.pluginRoot,
          service: this.service,
          keepAlive: async () => {
            await this.orca.host.call('settings.get', {})
          }
        })
        await this.server.listen()
      }
      const worktree = await this.resolveWorktree(this.cli)
      if (!worktree) {
        return {
          ok: false,
          error:
            'Could not resolve an Orca worktree for the browser tab. Open a worktree, then run Open Dashboard again.'
        }
      }
      const entryUrl = this.server.mintEntryUrl()
      const reused = await this.reuseOrCreateTab(this.cli, worktree.selector, entryUrl)
      return { ok: true, origin: this.server.origin, reused, worktree: worktree.selector }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to open dashboard'
      return { ok: false, error: message }
    }
  }

  async stop(): Promise<void> {
    await this.server?.close()
    this.server = null
  }

  private async resolveWorktree(cli: string) {
    const listed = await runOrcaCli(cli, ['worktree', 'list', '--json'])
    const parsed = parseCliJson(listed.stdout) as {
      result?: { worktrees?: Array<{ id?: string; path?: string; displayName?: string }> }
    }
    const worktrees = parsed.result?.worktrees ?? []
    const ps = await runOrcaCli(cli, ['worktree', 'ps', '--json']).catch(() => null)
    const activeIds = new Set<string>()
    if (ps?.ok) {
      try {
        const body = parseCliJson(ps.stdout) as {
          result?: { workspaces?: Array<{ worktreeId?: string; isActive?: boolean }> }
        }
        for (const row of body.result?.workspaces ?? []) {
          if (row.isActive && row.worktreeId) activeIds.add(row.worktreeId)
        }
      } catch {
        // ps shape is best-effort
      }
    }
    const annotated = worktrees.map((wt) => ({
      ...wt,
      isActive: Boolean(wt.id && activeIds.has(wt.id))
    }))
    return selectWorktree(annotated, this.pluginRoot)
  }

  private async reuseOrCreateTab(cli: string, selector: string, entryUrl: string): Promise<boolean> {
    const origin = new URL(entryUrl).origin
    const listed = await runOrcaCli(cli, ['tab', 'list', '--worktree', selector, '--json'])
    if (listed.ok) {
      const body = parseCliJson(listed.stdout) as {
        result?: { tabs?: Array<{ browserPageId?: string; url?: string }> }
      }
      const existing = (body.result?.tabs ?? []).find((tab) => (tab.url ?? '').startsWith(origin))
      if (existing?.browserPageId) {
        await runOrcaCli(cli, [
          'tab',
          'switch',
          '--page',
          existing.browserPageId,
          '--worktree',
          selector,
          '--focus',
          '--json'
        ])
        await runOrcaCli(cli, [
          'goto',
          '--url',
          entryUrl,
          '--page',
          existing.browserPageId,
          '--worktree',
          selector,
          '--json'
        ])
        return true
      }
    }
    const created = await runOrcaCli(cli, [
      'tab',
      'create',
      '--url',
      entryUrl,
      '--worktree',
      selector,
      '--json'
    ])
    if (!created.ok) {
      throw new Error(created.stderr || 'tab create failed')
    }
    return false
  }
}
