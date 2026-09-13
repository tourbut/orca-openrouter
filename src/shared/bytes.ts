export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

export function jsonUtf8Bytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value))
}
