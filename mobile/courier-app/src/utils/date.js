// Timestamps from the API are UTC. Formatting must pin this timezone
// explicitly instead of relying on the device's timezone (which may be
// misconfigured, e.g. UTC on some emulators) — couriers are in Asia/Dushanbe
// (UTC+5, no DST).
export const APP_TIMEZONE = 'Asia/Dushanbe'
