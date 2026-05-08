/**
 * Calendar slot guards. The react-big-calendar grid in AppointmentView
 * supports zoom levels down to 5 minutes, which lets the operator click-
 * drag a slot at non-15-min boundaries (e.g. :05, :10, :20). The booking
 * RPC + DB CHECK constraint reject those, so without a guard the user
 * fills the form, hits Save, and only then sees an increment error.
 *
 * isSlotOnFifteenMinuteGrid catches the click before the form opens and
 * the caller (AppointmentView's onSelectSlot wrapper) can show a toast
 * + skip the form open. No server roundtrip, no wasted form fill.
 */

/**
 * True when both start and end land on a :00 / :15 / :30 / :45 boundary
 * with zero seconds. Local timezone (Date.getMinutes()) is fine — every
 * real-world IANA timezone offset preserves 15-min mod against UTC, so
 * a local-clock :15 always maps to a UTC :15 (or :00, :30, :45 in
 * half-hour zones, all valid).
 */
export function isSlotOnFifteenMinuteGrid(slot: { start: Date; end: Date }): boolean {
  return (
    isOnGrid(slot.start) &&
    isOnGrid(slot.end)
  );
}

function isOnGrid(d: Date): boolean {
  return d.getMinutes() % 15 === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
}
