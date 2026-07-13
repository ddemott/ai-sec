/**
 * The shop's opening hours, derived from who is actually scheduled.
 *
 * There is no business-hours config in this system, by design: the building's
 * open window IS the union of staff shifts (see CLAUDE.md). That's the right
 * model — a shop is open when someone is there — but it left the AI unable to
 * TELL a caller when that is.
 *
 * WHY THIS EXISTS (a real call, 2026-07-12): the agent asked "what day and time
 * were you thinking?" — a wide-open question against a calendar the caller cannot
 * see. She named May 26 (already past) and then August 26 (past the end of the
 * schedule). Both were refused, correctly, and she gave up after seven minutes.
 * A receptionist would never do that. A receptionist says "we're open weekdays
 * one to five — what day works for you?" and the impossible answers never happen.
 *
 * Prevention beats recovery: the alternatives search now offers the soonest real
 * openings when a caller guesses wrong, but the better fix is that they never
 * have to guess.
 */
import type { PoolClient } from 'pg';

export interface DayHours {
  /** 0 = Sunday. */
  dow: number;
  /** Blocks within the day, e.g. 8–12 and 1–5 with a lunch gap between. */
  blocks: { start: string; end: string }[];
}

export interface BusinessHours {
  days: DayHours[];
  /** A spoken summary for the AI: "Monday to Friday, 1:00 PM to 5:00 PM". */
  spoken: string;
  /** The last date anyone is scheduled — the booking horizon. */
  bookableThrough: string | null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "13:00:00" → "1:00 PM" */
function speakTime(hhmmss: string): string {
  const [hStr, mStr] = hhmmss.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}:00 ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** "1:00 PM to 5:00 PM" — or, with a lunch gap, "8 to 12 and 1 to 5". */
function speakBlocks(blocks: { start: string; end: string }[]): string {
  return blocks
    .map((b) => `${speakTime(b.start)} to ${speakTime(b.end)}`)
    .join(' and ')
    .replace(/ and ([^,]*)$/, blocks.length > 1 ? ' and $1' : ' $1');
}

/**
 * Collapse consecutive weekdays that share identical hours into a range, the way
 * a person would say it: "Monday to Friday, 1:00 PM to 5:00 PM" rather than
 * reciting five identical days.
 */
function speakSchedule(days: DayHours[]): string {
  if (days.length === 0) return '';
  const sorted = [...days].sort((a, b) => a.dow - b.dow);

  const groups: { from: number; to: number; blocks: DayHours['blocks'] }[] = [];
  for (const day of sorted) {
    const key = JSON.stringify(day.blocks);
    const last = groups[groups.length - 1];
    if (last && JSON.stringify(last.blocks) === key && day.dow === last.to + 1) {
      last.to = day.dow; // extend the run
    } else {
      groups.push({ from: day.dow, to: day.dow, blocks: day.blocks });
    }
  }

  return groups
    .map((g) => {
      const when =
        g.from === g.to
          ? DAY_NAMES[g.from]
          : g.to === g.from + 1
            ? `${DAY_NAMES[g.from]} and ${DAY_NAMES[g.to]}`
            : `${DAY_NAMES[g.from]} to ${DAY_NAMES[g.to]}`;
      return `${when}, ${speakBlocks(g.blocks)}`;
    })
    .join('; ');
}

/**
 * Compute the tenant's opening hours from the shifts actually on the books.
 *
 * Looks FORWARD only (from today), because past shifts describe a schedule that
 * may no longer be true — an owner who moved from Saturdays to weekdays would
 * otherwise have the AI still announcing Saturdays.
 *
 * Returns null-ish (empty days, empty spoken) when nobody is scheduled at all;
 * callers must treat that as "we can't say we're open" rather than inventing
 * hours.
 */
export async function getBusinessHours(
  client: PoolClient,
  tenantId: string,
  lookaheadDays = 28
): Promise<BusinessHours> {
  const { rows } = await client.query<{
    dow: number;
    start_time: string;
    end_time: string;
  }>(
    `SELECT DISTINCT
            EXTRACT(DOW FROM es.shift_date)::int AS dow,
            es.start_time::text AS start_time,
            es.end_time::text   AS end_time
       FROM employee_schedule es
       JOIN employees e
         ON e.employee_id = es.employee_id
        AND e.tenant_id = es.tenant_id
        AND (e.is_active IS NULL OR e.is_active = true)
      WHERE es.tenant_id = $1
        AND es.is_off IS NOT TRUE
        AND es.shift_date >= CURRENT_DATE
        AND es.shift_date < CURRENT_DATE + $2::int
      ORDER BY dow, start_time`,
    [tenantId, lookaheadDays]
  );

  // Merge each weekday's overlapping staff shifts into the hours the SHOP is
  // open. Two techs working 1–5 and 3–7 means the shop is open 1–7, not two
  // separate windows — the caller doesn't care who is on.
  const byDow = new Map<number, { start: string; end: string }[]>();
  for (const r of rows) {
    const list = byDow.get(r.dow) ?? [];
    const last = list[list.length - 1];
    if (last && r.start_time <= last.end) {
      if (r.end_time > last.end) last.end = r.end_time; // overlap/adjacent → extend
    } else {
      list.push({ start: r.start_time, end: r.end_time }); // a genuine gap (lunch)
    }
    byDow.set(r.dow, list);
  }

  const days: DayHours[] = [...byDow.entries()]
    .map(([dow, blocks]) => ({ dow, blocks }))
    .sort((a, b) => a.dow - b.dow);

  const horizon = await client.query<{ last: string | null }>(
    `SELECT MAX(shift_date)::text AS last
       FROM employee_schedule
      WHERE tenant_id = $1 AND is_off IS NOT TRUE AND shift_date >= CURRENT_DATE`,
    [tenantId]
  );

  return {
    days,
    spoken: speakSchedule(days),
    bookableThrough: horizon.rows[0]?.last ?? null,
  };
}
