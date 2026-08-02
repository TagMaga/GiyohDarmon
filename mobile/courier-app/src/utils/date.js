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
