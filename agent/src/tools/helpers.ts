import type { ToolResponse } from '../toolsClient.js';

export function blank(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === '';
}

/** First non-blank value, or undefined. The order of the arguments is the order of trust. */
export function firstPhone(...vals: (string | null | undefined)[]): string | undefined {
  for (const v of vals) if (!blank(v)) return v!.trim();
  return undefined;
}

/** Pull a UUID appointment_id out of a successful booking response, if present. */
export function extractAppointmentId(res: ToolResponse): string | null {
  if (!res.ok || typeof res.result !== 'object' || res.result === null) return null;
  const id = (res.result as { appointment_id?: unknown }).appointment_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Format a tool response for the LLM. Keeps success + error shapes uniform. */
export function formatResponse(res: ToolResponse): string {
  if (res.ok) {
    if (typeof res.result === 'string') return res.result;
    // JSON.stringify(undefined) returns the JS value `undefined` (NOT the
    // string "undefined") — handing the LLM nothing to relay → a silent turn.
    // Guard so a success-with-no-result never produces dead air.
    const encoded = JSON.stringify(res.result);
    return encoded ?? 'Done.';
  }
  // Surface error_code for the LLM so the prompt's translation table fires.
  if (res.errorCode) {
    return JSON.stringify({ error: res.error, error_code: res.errorCode });
  }
  return JSON.stringify({ error: res.error });
}

/**
 * Spoken 12-hour clock from a local-naive datetime string
 * ("2026-07-15T16:00:00" → "4:00 PM"). Returns the raw input if it can't be
 * parsed, so the LLM still gets something to relay.
 */
export function spokenClock(localNaive: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(localNaive);
  if (!m) return localNaive;
  const h24 = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  // Guard out-of-range values (e.g. a malformed "T99:99") so we don't emit a
  // bogus "99:99" spoken time — fall back to the raw input as documented.
  if (h24 > 23 || min > 59) return localNaive;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${m[2]} ${ampm}`;
}

/**
 * True ONLY when both times parse cleanly AND differ to the minute (compared
 * on wall-clock: date + HH:MM). Uncertain input (unparseable) → false, so an
 * ambiguous value never fires a spurious "your time wasn't open" note.
 *
 * FRAME ASSUMPTION: both args are compared as LOCAL wall-clock digits. That is
 * correct because `requested_start` is prompted as local-naive (same as
 * window_from) and `booked_start` is backend-converted via toLocalWallClock →
 * local-naive. A trailing Z/offset on `requested_start` is stripped by the
 * regex, so a Z-suffix alone is harmless — BUT if the LLM ever sends a genuine
 * UTC *instant* (shifted digits, e.g. 21:30Z for 4:30pm local) this would false
 * "time_changed" on a correct booking. This is the live-call thing to watch.
 */
export function bookedTimeDiffers(requested: string, booked: string): boolean {
  const norm = (s: string) => /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(s)?.[1] ?? null;
  const r = norm(requested);
  const b = norm(booked);
  if (r === null || b === null) return false;
  return r !== b;
}

/**
 * Format a book_with_scheduling response for the LLM. On success it names the
 * ACTUAL booked time (the backend returns it already converted to the tenant's
 * local wall-clock) so the agent confirms what was really booked — not the time
 * the caller asked for. `book_with_scheduling_atomic` takes the earliest open
 * slot at or after `window_from`, so a caller who asked for a specific time can
 * land on a different (usually earlier) slot; when `requestedStart` is supplied
 * and the booked slot differs, the returned payload carries an explicit
 * directive to tell the caller the real time + that their pick wasn't open.
 *
 * `requestedStart` MUST be the caller's specifically-requested start, NOT the
 * search-window bound — for "next available" requests the caller named no time,
 * so it's omitted and no mismatch note ever fires (the booked slot legitimately
 * differs from the window bound by design).
 *
 * Falls back to the generic formatter for errors or any legacy/no-booked_start
 * response shape (fail-safe: worst case the LLM still sees the raw result JSON).
 */
export function formatBookingResponse(res: ToolResponse, requestedStart?: string): string {
  // A FAILED BOOKING IS NOT A STATEMENT ABOUT THE CALENDAR (2026-08-13,
  // SCL_KLvqZ2JkaQFU). The agent read out Monday 1:00 / 1:15 / 1:30, its next
  // booking attempt came back empty, and ten seconds later it told the caller
  // "It seems Dale is not available next week" — while Dale was scheduled 1-5 PM
  // every weekday that week and the agent itself had just recited three of those
  // slots. It relayed a WRITE failure as a READ fact and contradicted its own
  // correct answer; the caller nearly hung up. The raw error alone left that
  // reading open, so the payload now names the distinction and says what to do,
  // the same way OFF_GRID_TIME already does for an off-grid time.
  if (!res.ok) {
    return JSON.stringify({
      success: false,
      error: res.error,
      ...(res.errorCode ? { error_code: res.errorCode } : {}),
      instruction:
        'The BOOKING did not go through. This says nothing about whether the owner is free — ' +
        'do NOT tell the caller he is unavailable, and do not contradict open times you already ' +
        'read out. If you offered times, offer those SAME times again and book the one they ' +
        'pick. Otherwise call get_available_slots and offer what it returns.',
    });
  }
  if (typeof res.result !== 'object' || res.result === null) {
    return formatResponse(res);
  }
  const r = res.result as {
    appointment_id?: string;
    employee_name?: string | null;
    booked_start?: string | null;
    what_happens_next?: string | null;
  };
  const bookedStart = typeof r.booked_start === 'string' ? r.booked_start : null;
  if (!bookedStart) return formatResponse(res);

  const spoken = spokenClock(bookedStart);
  const withWhom = r.employee_name ? ` with ${r.employee_name}` : '';
  // The owner's own words for what happens AT the appointment. This function
  // REBUILDS the payload the model sees, so anything not copied here is
  // invisible to it — the exact way a backend field can ship and change
  // nothing (2026-07-31: added with the field, not after it went missing).
  const mechanics =
    typeof r.what_happens_next === 'string' && r.what_happens_next.trim()
      ? r.what_happens_next.trim()
      : null;
  const sayNext = mechanics ? ` Then say this VERBATIM: "${mechanics}"` : '';
  const payload: Record<string, unknown> = {
    success: true,
    appointment_id: r.appointment_id ?? null,
    booked_time: spoken,
    employee: r.employee_name ?? null,
    ...(mechanics ? { what_happens_next: mechanics } : {}),
    instruction: `Booked${withWhom} for ${spoken}. Confirm THIS exact time (${spoken}) to the caller — it is the actual booked slot.${sayNext}`,
  };
  if (requestedStart && bookedTimeDiffers(requestedStart, bookedStart)) {
    payload.time_changed = true;
    payload.requested_time = spokenClock(requestedStart);
    payload.instruction =
      `Booked${withWhom} for ${spoken}, but the caller asked for ${spokenClock(requestedStart)}, which was NOT open. ` +
      `Tell the caller you booked the closest opening — ${spoken}${withWhom} — and ask if that works or if they'd like a different time.${sayNext}`;
  }
  return JSON.stringify(payload);
}
