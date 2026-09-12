import assert from 'node:assert/strict'
import { test } from 'node:test'
import { completedUtcWindow, isUtcDateString, parseActivityDate } from '../src/shared/utc.ts'
import { frozenNow } from './helpers.ts'

test('completed 7/30 day windows exclude today and use UTC dates', () => {
  const now = frozenNow('2026-09-12T00:30:00.000Z')
  const week = completedUtcWindow(now, 7)
  assert.equal(week.end, '2026-09-11')
  assert.equal(week.start, '2026-09-05')
  assert.equal(week.dates.length, 7)
  assert.equal(week.dates[0], '2026-09-05')
  assert.equal(week.dates.at(-1), '2026-09-11')
  assert.ok(!week.dates.includes('2026-09-12'))

  const month = completedUtcWindow(now, 30)
  assert.equal(month.end, '2026-09-11')
  assert.equal(month.start, '2026-08-13')
  assert.equal(month.dates.length, 30)
  assert.ok(!month.dates.includes('2026-09-12'))
})

test('UTC date validation rejects impossible calendar days', () => {
  assert.equal(isUtcDateString('2026-02-29'), false)
  assert.equal(isUtcDateString('2024-02-29'), true)
  assert.equal(isUtcDateString('2026-09-12'), true)
})

test('KST evening still uses the UTC calendar date', () => {
  const now = frozenNow('2026-09-12T15:30:00.000Z')
  const week = completedUtcWindow(now, 7)
  assert.equal(week.end, '2026-09-11')
})

test('Activity dates may include a midnight timestamp and still map to the UTC day', () => {
  assert.equal(parseActivityDate('2026-09-11 00:00:00'), '2026-09-11')
  assert.equal(parseActivityDate('2026-09-11T00:00:00Z'), '2026-09-11')
  assert.equal(parseActivityDate('2026-09-11'), '2026-09-11')
  assert.equal(parseActivityDate('2026-09-11 12:00:00'), null)
})
