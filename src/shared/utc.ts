import type { PeriodDays } from './types.ts'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function isUtcDateString(value: string): boolean {
  const match = DATE_RE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const dt = new Date(Date.UTC(year, month - 1, day))
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  )
}

/** Activity rows may use `YYYY-MM-DD` or `YYYY-MM-DD 00:00:00`. */
export function parseActivityDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const day = trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed
  if (!isUtcDateString(day)) return null
  if (trimmed.length > 10) {
    const rest = trimmed.slice(10)
    if (!/^([ T]00:00:00(\.0+)?(Z)?)?$/.test(rest)) return null
  }
  return day
}

export function addUtcDays(dateStr: string, days: number): string {
  if (!isUtcDateString(dateStr)) {
    throw new Error(`invalid UTC date: ${dateStr}`)
  }
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number]
  return utcDateString(new Date(Date.UTC(year, month - 1, day + days)))
}

export function compareUtcDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function enumerateUtcDates(start: string, end: string): string[] {
  if (compareUtcDate(start, end) > 0) return []
  const dates: string[] = []
  let cursor = start
  while (compareUtcDate(cursor, end) <= 0) {
    dates.push(cursor)
    cursor = addUtcDays(cursor, 1)
  }
  return dates
}

/** Completed UTC days ending yesterday. Today is never included. */
export function completedUtcWindow(
  now: Date,
  days: PeriodDays
): { start: string; end: string; dates: string[] } {
  const today = utcDateString(now)
  const end = addUtcDays(today, -1)
  const start = addUtcDays(today, -days)
  return { start, end, dates: enumerateUtcDates(start, end) }
}

export function dateInInclusiveRange(date: string, start: string, end: string): boolean {
  return compareUtcDate(date, start) >= 0 && compareUtcDate(date, end) <= 0
}
