/**
 * WHY a requested time is not on offer.
 *
 * `available-slots` returns a membership list: a time is in `open_times` or it
 * is not. Membership was a deliberate fix (the model used to reason over a
 * prose range and refuse slots that were wide open) — but it answers only
 * WHETHER, never WHY, and a caller who asks for 2:30 and is handed 2:15 and
 * 3:00 hears an unexplained refusal.
 *
 * A model with no reason will invent one. On 2026-07-27 (SCL_VcKTTgo4kS2v,
 * CALL_IMPROVEMENTS.md #8) it told a caller "we can only book on the quarter
 * hour, so 2:30 won't work" — 2:30 IS a quarter hour, and the real reason was
 * that the caller's OWN appointment already occupied it. The truth
 * ("you already have 2:30 booked") was in the database the whole time and no
 * layer between it and the caller ever carried it.
 *
 * So the route now computes the reason from the same intervals it used to
 * compute the list, and hands the model a fact to relay instead of a gap to
 * fill. Pure functions here; the route owns the SQL and the clock.
 */

export type AvailabilityVerdict =
  /** In open_times — bookable right now. */
  | 'available'
  /** Blocked by an appointment belonging to THIS caller. */
  | 'occupied_by_caller'
  /** Blocked by someone else's appointment. */
  | 'occupied'
  /** Inside the day, but nobody is on shift then. */
  | 'outside_shift'
  /** Already gone by (only meaningful for today). */
  | 'past'
  /** On shift and unbooked, but the service does not fit before the window ends. */
  | 'no_room'
  /** Not on the quarter-hour grid the booking RPC accepts. */
  | 'off_grid'
  /** Nobody works at all that day. */
  | 'closed';

/** The booking grid. Mirrors isFifteenMinuteIncrement in appointmentValidation. */
const GRID_MINUTES = 15;

export interface Interval {
  start: number;
  end: number;
}

export interface BookedInterval extends Interval {
  /** The appointment belongs to the person on the phone. */
  isCaller: boolean;
}

export interface RequestedTimeExplanation {
  verdict: AvailabilityVerdict;
  /** Start of the blocking appointment, minutes-of-day (occupied verdicts only). */
  conflictStart?: number;
}

/**
 * Classify a requested start time against the day the route just computed.
 *
 * Order matters and encodes what a caller most needs to hear first:
 *   closed → past → occupied (theirs, then anyone's) → off_grid → outside_shift
 *   → no_room.
 * "Occupied" outranks "outside_shift" because a booking that runs past the end
 * of a shift still blocks the time, and telling someone the shop is closed when
 * their own meeting is sitting there is the same wrong answer in a new costume.
 */
export function explainRequestedTime(params: {
  requestedMinutes: number;
  durationMinutes: number;
  /** Shift coverage for the day, merged, minutes-of-day. Empty = closed. */
  coverage: Interval[];
  /** Existing appointments, UNBUFFERED, with attribution. */
  booked: BookedInterval[];
  /** Bookable grid starts (post-buffer, post-past-filter). */
  openMinutes: number[];
  isToday: boolean;
  currentMinutes: number;
}): RequestedTimeExplanation {
  const { requestedMinutes, durationMinutes, coverage, booked, openMinutes } = params;

  // The list is the authority on YES — never contradict it (that is the whole
  // point of membership-not-arithmetic).
  if (openMinutes.includes(requestedMinutes)) return { verdict: 'available' };

  if (coverage.length === 0) return { verdict: 'closed' };

  if (params.isToday && requestedMinutes < params.currentMinutes) return { verdict: 'past' };

  // Half-open overlap, same predicate as the GiST exclusion constraint: an
  // appointment blocks the request when it starts before the request ends and
  // ends after the request starts.
  const requestedEnd = requestedMinutes + durationMinutes;
  const overlapping = booked.filter((b) => b.start < requestedEnd && b.end > requestedMinutes);
  if (overlapping.length > 0) {
    // Prefer the caller's own — it is both the more useful answer and the one
    // that stops a duplicate booking before it starts.
    const mine = overlapping.find((b) => b.isCaller);
    const chosen = mine ?? overlapping[0];
    return {
      verdict: mine ? 'occupied_by_caller' : 'occupied',
      conflictStart: chosen.start,
    };
  }

  // Appointments live on a 15-minute grid (the RPC rejects anything else), so
  // an off-grid request is genuinely unbookable AS ASKED. Ranked below
  // occupancy on purpose: if their own meeting is sitting there, that is the
  // fact they need. Note the symmetry with the bug that started this batch —
  // "we book on the quarter hour" was a LIE about 2:30 and is the TRUTH about
  // 2:10, and the difference is exactly what this engine now knows.
  if (requestedMinutes % GRID_MINUTES !== 0) return { verdict: 'off_grid' };

  const covering = coverage.find((c) => c.start <= requestedMinutes && c.end > requestedMinutes);
  if (!covering) return { verdict: 'outside_shift' };

  // On shift, nothing booked over it — so the service simply does not fit
  // (window ends too soon, or the buffer around a neighbouring booking eats it).
  return { verdict: 'no_room' };
}

/** Minutes-of-day → the spoken shape the rest of this route uses ("2:30 PM"). */
function clock(mins: number): string {
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * The sentence the agent relays. Written to be SPOKEN verbatim — the model's
 * job here is to read a true reason aloud, not to compose one.
 *
 * `occupied` deliberately says nothing about who: another caller's name, or
 * even "someone else has it", is that person's business. "Already spoken for"
 * is true and discloses nothing.
 */
export function spokenReason(
  explanation: RequestedTimeExplanation,
  requestedLabel: string,
  /** Spoken label of the blocking appointment's START, when there is one. */
  conflictLabel?: string
): string | null {
  // For an occupied verdict, name the BLOCKING appointment's own time: a caller
  // who asks for 2:10 has a meeting at 2:00, and "you already have one at 2:10"
  // is a small lie in the middle of a sentence whose whole job is being true.
  const blockedAt = conflictLabel ?? requestedLabel;
  switch (explanation.verdict) {
    case 'available':
      return null; // nothing to explain — it is bookable
    case 'occupied_by_caller':
      return `You already have an appointment at ${blockedAt}.`;
    case 'occupied':
      return `${blockedAt} is already spoken for.`;
    case 'off_grid':
      return `We book on the quarter hour, so ${requestedLabel} isn't a time I can book.`;
    case 'outside_shift':
      return `We're not open at ${requestedLabel} that day.`;
    case 'past':
      return `${requestedLabel} has already passed today.`;
    case 'no_room':
      return `There isn't enough time at ${requestedLabel} for the full appointment.`;
    case 'closed':
      return `We're closed that day.`;
  }
}

/**
 * What the model must DO about it — the reason alone is not an instruction, and
 * a model handed a fact with no next step will improvise the next step.
 */
export function reasonNote(explanation: RequestedTimeExplanation): string | null {
  switch (explanation.verdict) {
    case 'available':
      return `The requested time IS available — book it. Do not offer alternatives.`;
    case 'occupied_by_caller':
      return (
        `The caller's OWN appointment occupies that time. Say so plainly, and ask whether ` +
        `they want to keep it, move it, or book something else — never book a second one ` +
        `silently, and never imply the time is unavailable for some other reason.`
      );
    case 'occupied':
      return (
        `That exact time is taken. Say it is already spoken for — never name or describe ` +
        `whose appointment it is — then offer the nearest times from open_times.`
      );
    case 'outside_shift':
      return `Nobody is on shift then. Say so, then offer the nearest times from open_times.`;
    case 'past':
      return `That time is in the past today. Say so, then offer the nearest times from open_times.`;
    case 'no_room':
      return (
        `The appointment does not fit in the remaining gap. Say there isn't enough time ` +
        `there, then offer the nearest times from open_times.`
      );
    case 'off_grid':
      return (
        `That time is not on the quarter-hour grid, so it cannot be booked as asked. Say ` +
        `so and offer the nearest times from open_times. (Only say this when the reason IS ` +
        `off_grid — it was once said about a time that was perfectly on the grid.)`
      );
    case 'closed':
      return `Nobody works that day at all. Say so, then offer the soonest day that is open.`;
  }
}

/**
 * Parse a spoken/typed time into minutes-of-day. Accepts what a model actually
 * sends: "2:30 PM", "2 PM", "14:30", "2:30pm". Returns null on anything else —
 * an unparseable request must be IGNORED, never guessed into a wrong answer.
 *
 * AMBIGUITY IS UNPARSEABLE (review catch on #311). A bare "2" or "9:30" could be
 * either half of the day, and guessing turns this engine into the thing it was
 * built to replace: a confident, wrong explanation ("we're not open at 2:00 AM"
 * to someone who meant 2 PM). Only an explicit am/pm, or a 24-hour value that
 * cannot be anything else (13-23), is accepted.
 */
export function parseRequestedTime(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ampm = m[3];
  if (minute > 59) return null;
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    if (ampm === 'pm' && hour !== 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
  } else {
    // No marker: only an unambiguous 24-hour reading survives. 0 is midnight
    // (nobody says "0" for noon); 1-12 could be either half of the day.
    if (hour > 23) return null;
    if (hour >= 1 && hour <= 12) return null;
  }
  return hour * 60 + minute;
}

export { clock as formatMinutesOfDay };
