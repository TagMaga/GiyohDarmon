// toLocalYMD formats a Date as YYYY-MM-DD using its local calendar fields
// (getFullYear/getMonth/getDate), not toISOString's UTC conversion. The app's
// users are in Asia/Dushanbe (UTC+5); toISOString() shifts any local time
// before 05:00 back onto the previous UTC day, so a "today" default computed
// with toISOString().slice(0, 10) shows yesterday's date for roughly the
// first five hours of every local day — freshly created orders/records then
// silently fall outside that default filter.
export function toLocalYMD(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}
