# Orca host patch: panel → worker requests

Installed Orca **1.4.198** (verified locally) does not expose a public panel-to-worker request API.

Confirmed from the 1.4.198 unpacked host API:

- Panel-callable actions: `workspace.readContext`, `terminal.sendText`, `notifications.show`
- Panel CSP: `connect-src 'none'` (no direct HTTP)
- Worker host methods (`secrets`, `storage`, `settings`) are **not** panel-callable
- Worker protocol parent messages: `init`, `invokeCommand`, `deliverEvent`, `hostResult`, `shutdown`
- Worker env is an allowlist; `OPENROUTER_MANAGEMENT_KEY` is not inherited

Do not patch a user's installed Orca in place. This directory is a separate integration artifact.

## Contract (new, not present in 1.4.198)

Panel iframe (opaque origin) posts:

```json
{
  "type": "orca-panel-plugin-request",
  "requestId": "req-1",
  "method": "usage.query",
  "params": { "period": 7, "forceRefresh": false }
}
```

Trusted renderer relays **sessionToken + method + params** to main. The panel cannot name a plugin id, host method, or session belonging to another plugin.

Allowed worker methods for this plugin:

- `connection.status`
- `connection.save`
- `connection.remove`
- `usage.query`
- `preferences.update`

Host replies:

```json
{
  "type": "orca-panel-plugin-result",
  "requestId": "req-1",
  "ok": true,
  "value": {}
}
```

## Required Orca changes

Wire the reference dispatcher in `dispatcher.ts` / `protocol.ts` at:

1. `src/shared/plugins/plugin-panel-bridge.ts` — new message types beside `orca-panel-action`
2. Renderer panel host — if `looksLikePanelPluginRequest`, attach the **existing** panel session token; never take identity from the iframe
3. `src/shared/plugins/plugin-host-protocol.ts` — add `invokeRequest` / `requestResult`
4. Worker entry (`plugin-host-entry`) — `orca.requests.register(method, handler)`
5. Main plugin host — resolve session → qualified plugin key, check consent/enabled/method allowlist, start worker, enforce 64 KiB / 30 messages per 10s, 20s timeout
6. Drop results when the panel session is gone, the plugin is disabled, or the connection generation changed
7. Redact secrets from logs and error strings

Suggested worker protocol:

```ts
{ type: 'invokeRequest', callId: number, method: string, params?: unknown }
{ type: 'requestResult', callId: number, ok: boolean, value?: unknown, error?: string }
```

Keep this path separate from `PLUGIN_HOST_API_V0`. These methods are plugin-private, not extra host actions.

## Tests in this repo

`tests/host-patch.test.ts` covers identity isolation, allowlist, oversized payloads, rate limits, stale sessions, and secret redaction. Those tests do **not** mean 1.4.198 already has the bridge.

## Applying

Copy the protocol into an Orca source checkout and add host tests there. Do not unpack and rewrite `/home/shin/.local/opt/orca`. After a host build that includes this bridge, reload the plugin from Settings → Plugins → Development.
