import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

// Timestamps from the API are UTC. Formatting must pin this timezone
// explicitly instead of relying on the device's timezone (which may be
// misconfigured, e.g. UTC on some emulators) — couriers are in Asia/Dushanbe
// (UTC+5, no DST).
export const APP_TIMEZONE = 'Asia/Dushanbe'

// dayjsTZ wraps dayjs(input) pinned to Asia/Dushanbe. Use this instead of a
// bare dayjs(...) call anywhere a timestamp is displayed or a "today"/"this
// week" comparison is made, so the result doesn't depend on the device's own
// timezone.
export function dayjsTZ(input) {
  return dayjs(input).tz(APP_TIMEZONE)
}

// appDayStartISO returns the UTC ISO instant for midnight, `daysFromToday`
// days from today, in Asia/Dushanbe. Use it when sending a chosen date to the
// API: building the date with `new Date()` + setHours(0,0,0,0) anchors
// midnight to the *device's* timezone, so a device on UTC sends 05:00
// Dushanbe (or the previous day) instead of the day the courier picked.
export function appDayStartISO(daysFromToday = 0) {
  return dayjsTZ().add(daysFromToday, 'day').startOf('day').toDate().toISOString()
}
