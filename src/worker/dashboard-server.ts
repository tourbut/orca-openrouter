import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { jsonUtf8Bytes } from '../shared/bytes.ts'
import { isMethodName } from '../shared/methods.ts'
import { PANEL_MESSAGE_MAX_BYTES, type MethodName } from '../shared/types.ts'
import { redactSecrets } from '../shared/redact.ts'
import type { UsageService } from './service.ts'

const MAX_BODY_BYTES = 16 * 1024
const ENTRY_TTL_MS = 2 * 60 * 1000
const CHROMIUM_UNSAFE_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 77, 79, 87, 95, 101, 102, 103,
  104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 139, 143, 179, 389, 427, 465, 512, 513, 514,
  515, 526, 530, 531, 532, 540, 548, 556, 563, 587, 601, 636, 993, 995, 2049, 3659, 4045, 6000,
  6665, 6666, 6667, 6668, 6669, 6697
])

export type DashboardKeepAlive = () => Promise<void>

export class DashboardServer {
  private server: Server | null = null
  private port: number | null = null
  private entry: { token: string; expiresAt: number } | null = null
  private sessions = new Set<string>()
  private closed = false

  constructor(
    private readonly options: {
      pluginRoot: string
      service: UsageService
      keepAlive?: DashboardKeepAlive
      now?: () => number
    }
  ) {}

  get origin(): string {
    if (this.port == null) throw new Error('dashboard server is not listening')
    return `http://127.0.0.1:${this.port}`
  }

  async listen(): Promise<{ port: number; origin: string }> {
    if (this.server && this.port != null) return { port: this.port, origin: this.origin }
    this.closed = false
    for (let attempt = 0; attempt < 8; attempt++) {
      const port = await this.listenOnce(0)
      if (!CHROMIUM_UNSAFE_PORTS.has(port)) {
        this.port = port
        return { port, origin: this.origin }
      }
      await this.stopListening()
    }
    throw new Error('could not bind a Chromium-safe loopback port')
  }

  mintEntryUrl(): string {
    const token = randomBytes(24).toString('hex')
    this.entry = { token, expiresAt: (this.options.now ?? Date.now)() + ENTRY_TTL_MS }
    return `${this.origin}/?entry=${token}`
  }

  async close(): Promise<void> {
    this.closed = true
    this.entry = null
    this.sessions.clear()
    await this.stopListening()
  }

  private listenOnce(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handle(req, res)
      })
      this.server = server
      server.on('error', reject)
      server.listen(port, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('dashboard server bound without a port'))
          return
        }
        resolve(address.port)
      })
    })
  }

  private stopListening(): Promise<void> {
    const server = this.server
    this.server = null
    this.port = null
    if (!server) return Promise.resolve()
    return new Promise((resolve) => {
      server.close(() => resolve())
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!this.allowHost(req)) {
        this.send(res, 400, { ok: false, error: 'invalid host' })
        return
      }
      const url = new URL(req.url ?? '/', this.origin)
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        this.sendHtml(res, this.readAsset('dashboard.html'))
        return
      }
      if (req.method === 'GET' && url.pathname === '/dashboard.js') {
        this.sendJs(res, this.readAsset('dashboard.js'))
        return
      }
      if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) {
        this.send(res, 404, { ok: false, error: 'not found' })
        return
      }
      if (!this.allowOrigin(req)) {
        this.send(res, 403, { ok: false, error: 'invalid origin' })
        return
      }
      const body = await this.readJson(req)
      if (body === 'oversized') {
        this.send(res, 413, { ok: false, error: 'request too large' })
        return
      }
      if (body === 'invalid') {
        this.send(res, 400, { ok: false, error: 'invalid json' })
        return
      }
      if (url.pathname === '/api/session/exchange') {
        this.exchange(body, res)
        return
      }
      if (!this.authorized(req)) {
        this.send(res, 401, { ok: false, error: 'authentication required' })
        return
      }
      await this.options.keepAlive?.().catch(() => undefined)
      const method = routeToMethod(url.pathname)
      if (!method) {
        this.send(res, 404, { ok: false, error: 'unknown method' })
        return
      }
      const result = await this.options.service.dispatch(method, body)
      if (jsonUtf8Bytes(result) > PANEL_MESSAGE_MAX_BYTES) {
        this.send(res, 500, { ok: false, error: 'result too large' })
        return
      }
      if (result.ok) {
        this.send(res, 200, { ok: true, value: result.value })
        return
      }
      this.send(res, 200, {
        ok: false,
        errorCode: result.error.code,
        error: redactSecrets(result.error.message),
        value: result.snapshot
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'server error'
      this.send(res, 500, { ok: false, error: redactSecrets(message) })
    }
  }

  private exchange(body: unknown, res: ServerResponse): void {
    const token =
      typeof body === 'object' && body && 'entryToken' in body
        ? String((body as { entryToken?: unknown }).entryToken ?? '')
        : ''
    const now = (this.options.now ?? Date.now)()
    if (!this.entry || this.entry.token !== token || this.entry.expiresAt < now) {
      this.send(res, 401, { ok: false, error: 'entry token is invalid or expired' })
      return
    }
    this.entry = null
    const session = randomBytes(24).toString('hex')
    this.sessions.add(session)
    this.send(res, 200, { ok: true, value: { sessionToken: session } })
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? ''
    const match = /^Bearer\s+(\S+)$/i.exec(header)
    return Boolean(match && this.sessions.has(match[1] ?? ''))
  }

  private allowHost(req: IncomingMessage): boolean {
    const host = (req.headers.host ?? '').toLowerCase()
    return host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}`
  }

  private allowOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin
    if (!origin) return true
    return origin === `http://127.0.0.1:${this.port}` || origin === `http://localhost:${this.port}`
  }

  private readAsset(name: 'dashboard.html' | 'dashboard.js'): string {
    return readFileSync(join(this.options.pluginRoot, 'dist', name), 'utf8')
  }

  private readJson(req: IncomingMessage): Promise<unknown | 'oversized' | 'invalid'> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          req.destroy()
          resolve('oversized')
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (size === 0) {
          resolve({})
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          resolve('invalid')
        }
      })
      req.on('error', () => resolve('invalid'))
    })
  }

  private send(res: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    })
    res.end(json)
  }

  private sendHtml(res: ServerResponse, html: string): void {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'none'; connect-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"
    })
    res.end(html)
  }

  private sendJs(res: ServerResponse, js: string): void {
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store'
    })
    res.end(js)
  }
}

function routeToMethod(pathname: string): MethodName | null {
  const map: Record<string, MethodName> = {
    '/api/connection/status': 'connection.status',
    '/api/connection/save': 'connection.save',
    '/api/connection/remove': 'connection.remove',
    '/api/usage/query': 'usage.query',
    '/api/preferences': 'preferences.update'
  }
  const method = map[pathname]
  return method && isMethodName(method) ? method : null
}
