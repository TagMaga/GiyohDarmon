// Timestamps are stored/transmitted as UTC. Display formatting must pin this
// timezone explicitly instead of relying on the browser/device's timezone
// (which may be misconfigured, e.g. UTC on some emulators/webviews) — the
// app's users are in Asia/Dushanbe (UTC+5, no DST).
export const APP_TIMEZONE = 'Asia/Dushanbe'

const ymdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// toLocalYMD formats a Date as YYYY-MM-DD using its Asia/Dushanbe calendar
// fields, not the browser/device's own timezone or toISOString's UTC
// conversion. A device whose clock/timezone defaults to UTC (or anything
// other than Dushanbe) would otherwise compute the wrong "today" for part of
// every day — e.g. toISOString().slice(0, 10) shifts any local time before
// 05:00 back onto the previous UTC day, so freshly created orders/records
// would silently fall outside a "today" default filter.
export function toLocalYMD(date) {
  const parts = ymdFormatter.formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

// ── Write side ────────────────────────────────────────────────────────────────
// Display was pinned to APP_TIMEZONE, but the code that *creates* timestamps
// from user input still resolved wall-clock values against the browser's own
// timezone. On a browser running UTC that stored "14:00" as 14:00Z, which the
// pinned display then rendered back as 19:00. Everything below exists so a
// wall-clock value the user typed/picked is anchored to Asia/Dushanbe on the
// way *in*, matching how it will be rendered on the way out.

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

// tzOffsetMs returns APP_TIMEZONE's UTC offset, in milliseconds, at instant
// `date`. Derived from Intl rather than hardcoded to +5 so the helpers stay
// correct if the app's timezone is ever changed to one that observes DST.
function tzOffsetMs(date) {
  const parts = partsFormatter.formatToParts(date)
  const get = (type) => Number(parts.find((p) => p.type === type).value)
  const asUTC = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour'), get('minute'), get('second'),
  )
  return asUTC - date.getTime()
}

// appWallClockToDate converts a wall-clock string — "YYYY-MM-DD",
// "YYYY-MM-DDTHH:mm" (the <input type="datetime-local"> value format), or
// "YYYY-MM-DDTHH:mm:ss" — into the Date representing that moment in
// Asia/Dushanbe. Use this instead of `new Date(value)`, which the JS spec
// requires be interpreted in the *browser's* timezone when the string carries
// no offset.
export function appWallClockToDate(wallClock) {
  if (!wallClock) return null
  const [datePart, timePart = ''] = String(wallClock).split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  if (!y || !m || !d) return null
  const [hh = 0, mm = 0, ss = 0] = timePart.split(':').map(Number)

  const naive = Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0)
  // Offset depends on the instant, and the instant depends on the offset —
  // resolve once against the naive guess, then re-check in case the result
  // landed on the other side of a DST transition.
  const firstPass = new Date(naive - tzOffsetMs(new Date(naive)))
  return new Date(naive - tzOffsetMs(firstPass))
}

// appWallClockNow returns the current Asia/Dushanbe wall clock as
// "YYYY-MM-DDTHH:mm", the value format <input type="datetime-local"> expects.
// Use it for `min`/`max`/defaults — toISOString() there yields a UTC wall
// clock, which the input compares against a local-time value.
export function appWallClockNow(date = new Date()) {
  const parts = partsFormatter.formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

// ── Calendar math ─────────────────────────────────────────────────────────────

// appToday returns a browser-local Date at midnight whose calendar fields are
// *today in Asia/Dushanbe*. Range pickers do their arithmetic (addDays,
// startOfMonth) on browser-local Dates, so this is the anchor to build presets
// from: `new Date()` would resolve to the previous day between 00:00 and 05:00
// Dushanbe on a browser running UTC, silently excluding just-created records
// from a "Сегодня" filter.
export function appToday() {
  const [y, m, d] = toLocalYMD(new Date()).split('-').map(Number)
  return new Date(y, m - 1, d)
}

// isSameAppDay reports whether two timestamps fall on the same Asia/Dushanbe
// calendar day. Replaces `a.toDateString() === b.toDateString()`, which
// compares browser-local days.
export function isSameAppDay(a, b) {
  if (!a || !b) return false
  const da = a instanceof Date ? a : new Date(a)
  const db = b instanceof Date ? b : new Date(b)
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false
  return toLocalYMD(da) === toLocalYMD(db)
}

// addDaysYMD shifts a "YYYY-MM-DD" string by n calendar days, staying in
// string space so no timezone is involved.
export function addDaysYMD(ymd, n) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return [
    dt.getUTCFullYear(),
    String(dt.getUTCMonth() + 1).padStart(2, '0'),
    String(dt.getUTCDate()).padStart(2, '0'),
  ].join('-')
}
