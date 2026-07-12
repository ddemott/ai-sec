/**
 * Render a reminder's lead time the way a person would say it.
 *
 * Reminder leads used to be a closed set of whole hours (72/24/2), so the SMS
 * template could get away with `in ${hoursUntil}h`. Callers can now choose any
 * lead — "text me 30 minutes before" — and 0.5 hours through that template
 * reads "in 0.5h", which is not something a receptionist would ever say.
 *
 * Sub-hour leads are the common case for the voice flow (the default is 30
 * minutes), so minutes are the unit of truth and hours/days are the rollup.
 */
export function formatLeadTime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'shortly';

  const mins = Math.round(minutes);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;

  // Whole hours read best as hours ("2 hours"); a ragged lead (90 min) keeps its
  // remainder rather than rounding away information the customer chose.
  if (mins < 60 * 24) {
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    const hourPart = `${hours} hour${hours === 1 ? '' : 's'}`;
    return rem === 0 ? hourPart : `${hourPart} ${rem} minute${rem === 1 ? '' : 's'}`;
  }

  // Round FIRST, then carry: rounding the remainder independently can push it to
  // 24 hours and print "1 day 24 hours" (e.g. 2879 minutes = 2 days minus 1 min).
  // Work in whole rounded hours so the carry is arithmetic, not a special case.
  const totalHours = Math.round(mins / 60);
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  const dayPart = `${days} day${days === 1 ? '' : 's'}`;
  return remHours === 0 ? dayPart : `${dayPart} ${remHours} hour${remHours === 1 ? '' : 's'}`;
}
