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
