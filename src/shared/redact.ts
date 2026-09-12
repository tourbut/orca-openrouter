const KEY_PATTERNS = [
  /sk-or-v1-[A-Za-z0-9_-]+/g,
  /sk-or-[A-Za-z0-9_-]+/g,
  /Bearer\s+\S+/gi
]

export function redactSecrets(value: string): string {
  let next = value
  for (const pattern of KEY_PATTERNS) {
    next = next.replace(pattern, '[redacted]')
  }
  return next
}

export function assertNoSecret(value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (/sk-or-v1-[A-Za-z0-9_-]{8,}/.test(text) || /Bearer\s+sk-/i.test(text)) {
    throw new Error('refusing to expose a secret in plugin output')
  }
}
