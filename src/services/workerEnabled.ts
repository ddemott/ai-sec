/**
 * Should a background worker run in this environment?
 *
 * The rule is asymmetric on purpose:
 *
 *   production      → ON unless explicitly disabled (`ENABLE_X=false`)
 *   everywhere else → OFF unless explicitly enabled (`ENABLE_X=true`)
 *
 * The non-prod half is what lets the real-DB tests drive these workers without
 * every local `npm start` scheduling reminders at 60-second intervals.
 *
 * The prod half is what stops a missing env var from silently taking a worker
 * offline. That is the more dangerous mistake here and not hypothetically: this
 * project has already had thirteen days of zero reminders while the worker
 * reported itself healthy, so "off because nobody set a variable" is a failure
 * mode worth designing against.
 *
 * WHAT CHANGED 2026-08-21: the escape hatch. Production used to ignore the
 * variable outright — `isProduction || process.env.ENABLE_X === 'true'` is
 * simply `true` whenever isProduction is true. So a worker misbehaving in prod
 * (the schedule extender writing rows you did not want, say) could only be
 * stopped by shipping a deploy. Now `ENABLE_X=false` stops it in seconds, and
 * every other value — including unset, which is the normal case — keeps the
 * previous behaviour byte for byte.
 *
 * Deliberately only the exact string `'false'`. Not `'0'`, not `'no'`, not
 * case-insensitive: a kill switch that fires on a fat-fingered value is worse
 * than one that does not fire at all, because the failure is silent and the
 * worker is off.
 */
export function workerEnabled(flag: string | undefined, isProduction: boolean): boolean {
  if (isProduction) return flag !== 'false';
  return flag === 'true';
}
