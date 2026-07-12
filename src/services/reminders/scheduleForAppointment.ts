import type { FastifyBaseLogger } from 'fastify';
import type { PoolClient } from 'pg';

import { normalizePhone } from '../../../shared/phone.js';

/**
 * The legacy bundle, seeded when nobody opted into a specific lead — i.e. every
 * dashboard/web booking. Unchanged behavior for those paths.
 */
const STANDARD_BUNDLE = [
  { type: 'confirmation' as const, leadMinutes: 0 },
  { type: '72h' as const, leadMinutes: 72 * 60 },
  { type: '24h' as const, leadMinutes: 24 * 60 },
  { type: '2h' as const, leadMinutes: 2 * 60 },
];

/** What the agent offers when a caller says yes without naming a time. */
export const DEFAULT_REMINDER_LEAD_MINUTES = 30;

/** Matches the DB CHECK (reminder_schedules_lead_minutes_sane): 0 … 90 days. */
const MAX_LEAD_MINUTES = 129_600;

/**
 * The preference key the voice agent writes when a caller picks a lead time.
 * Read back here so a RESCHEDULE (which cancels and reseeds) rebuilds the row at
 * the lead the caller actually asked for, and so their NEXT booking defaults to
 * it without the model having to remember to pass it again.
 */
export const REMINDER_LEAD_PREF_KEY = 'reminder_lead_minutes';

export type WithTenantClient = <T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
) => Promise<T>;

/** Clamp a caller-supplied lead to something a reminder can actually mean. */
function sanitizeLead(minutes: number | null | undefined): number | null {
  if (minutes === null || minutes === undefined) return null;
  if (!Number.isFinite(minutes)) return null;
  const rounded = Math.round(minutes);
  if (rounded <= 0 || rounded > MAX_LEAD_MINUTES) return null;
  return rounded;
}

/**
 * Seed an appointment's reminders. Fire-and-forget: errors are logged but never
 * bubble back — a reminder failure must never fail the underlying booking.
 *
 * TWO SHAPES, and which one you get depends on whether a caller opted in:
 *
 *   - opted in (a lead time is passed, or one is on file as a customer
 *     preference) → confirmation + ONE reminder at exactly that lead. This is
 *     the voice path: the caller said "text me 30 minutes before", so we send
 *     them a confirmation and one text 30 minutes before. Nothing else.
 *   - no lead → the legacy bundle (confirmation + 72h/24h/2h). This is every
 *     dashboard/web booking, unchanged.
 *
 * Why not seed the full bundle for opted-in callers too: they consented to a
 * reminder, not to five texts about one haircut. The fastest way to lose SMS
 * consent entirely is to spend it — a STOP reply revokes consent for everything,
 * including the confirmation they actually wanted. (Product decision 2026-07-12.)
 *
 * Why no `ReminderService` instance: that class pulls in CommunicationService
 * + ConsentService + TenantConfigService just to write a couple of rows. The
 * worker handles consent + delivery at send time.
 *
 * Skips silently if (a) the appointment row vanished between RPC + lookup,
 * (b) start_time is in the past or unparseable. Past-time is the documented
 * walk-in carve-out: operators can record an appointment for a moment that
 * has already happened, and reminders for it would be nonsensical.
 */
export async function scheduleRemindersForAppointment(
  withTenantClient: WithTenantClient,
  tenantId: string,
  appointmentId: string,
  logger?: FastifyBaseLogger,
  opts: { reminderLeadMinutes?: number | null } = {}
): Promise<void> {
  try {
    await withTenantClient(tenantId, async (client) => {
      const { rows } = await client.query<{
        start_time: string;
        customer_id: string | null;
        customer_email: string | null;
        customer_phone: string | null;
        pref_lead: string | null;
      }>(
        // The stored preference rides along on the same round-trip. It's what
        // makes a RESCHEDULE keep the caller's chosen lead (reschedule cancels
        // and reseeds with no opts) and what makes their next booking default to
        // it without the model re-passing it.
        `SELECT a.start_time,
                c.customer_id,
                c.email AS customer_email,
                c.phone AS customer_phone,
                (SELECT cp.pref_value
                   FROM customer_preferences cp
                  WHERE cp.customer_id = c.customer_id
                    AND cp.tenant_id = a.tenant_id
                    AND cp.pref_key = $3) AS pref_lead
           FROM appointments a
           LEFT JOIN customers c ON c.customer_id = a.customer_id AND c.tenant_id = a.tenant_id
          WHERE a.appointment_id = $1 AND a.tenant_id = $2`,
        [appointmentId, tenantId, REMINDER_LEAD_PREF_KEY]
      );
      const row = rows[0];
      if (!row) return;

      const appointmentDateTime = new Date(row.start_time);
      const now = new Date();
      if (Number.isNaN(appointmentDateTime.getTime()) || appointmentDateTime <= now) {
        return;
      }

      // Explicit beats stored: what the caller said on THIS call wins over what
      // they said on a previous one ("actually, make it an hour this time").
      const storedLead = row.pref_lead !== null ? sanitizeLead(Number(row.pref_lead)) : null;
      const leadMinutes = sanitizeLead(opts.reminderLeadMinutes) ?? storedLead;

      let bundle: Array<{ type: string; leadMinutes: number }>;
      if (leadMinutes !== null) {
        bundle = [
          { type: 'confirmation', leadMinutes: 0 },
          { type: 'custom', leadMinutes },
        ];
        // Booked INSIDE the lead window ("I'll be there in 20 minutes" against a
        // 30-minute lead) — the reminder time is already past. Seeding it would
        // fire on the next 60s tick, i.e. a "reminder" arriving after they were
        // due to leave. Drop just that row; the confirmation still goes out.
        const remindAt = new Date(appointmentDateTime.getTime() - leadMinutes * 60_000);
        if (remindAt <= now) {
          bundle = bundle.filter((r) => r.type !== 'custom');
          logger?.info(
            { tenantId, appointmentId, leadMinutes },
            'reminder lead falls inside the booking window — confirmation only, no advance reminder'
          );
        }
      } else {
        bundle = [...STANDARD_BUNDLE];
      }

      // Build one multi-row INSERT for the 4 reminder rows. Sequential
      // single-row INSERTs each acquire `audit_log` row locks one at
      // a time, creating a window where the test's cleanup cascade
      // (DELETE FROM tenants → cascade to reminder_schedules → audit
      // trigger) deadlocks against this in-flight bundle. Single
      // INSERT acquires the locks once and releases them once.
      // Origin: 2026-05-18 — same shape as the expand-weekly fix in
      // src/services/expandWeeklyToSchedule.ts.
      //
      // Idempotency lives in the DATABASE, not app logic: the partial unique
      // index reminder_schedules_one_scheduled_per_type (migration
      // 20260701020000) allows at most one 'scheduled' row per
      // (appointment_id, reminder_type); ON CONFLICT DO NOTHING makes a
      // duplicate seed (retry wrapper, double tool-call — even concurrent)
      // a silent no-op instead of a double-remind. Kept as a single
      // statement on purpose: an app-level probe was check-then-insert
      // (race-prone), and a transaction + advisory lock deadlocked against
      // the appointments cascade in E2E — same hazard as above.
      // Reschedules still reseed: rescheduleRemindersForAppointment cancels
      // the old bundle first, which vacates the partial index.
      if (bundle.length === 0) return;

      const valuesSql: string[] = [];
      const params: (string | number | null)[] = [];
      bundle.forEach((r, i) => {
        // The confirmation goes out now; every other reminder is anchored to the
        // appointment. lead_minutes is stored alongside so the send path never
        // has to parse the type name back into a duration.
        const scheduledFor =
          r.type === 'confirmation'
            ? now
            : new Date(appointmentDateTime.getTime() - r.leadMinutes * 60_000);
        const base = i * 7;
        valuesSql.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, 'scheduled')`
        );
        params.push(
          appointmentId,
          tenantId,
          row.customer_email,
          row.customer_phone,
          r.type,
          scheduledFor.toISOString(),
          r.leadMinutes
        );
      });
      await client.query(
        `INSERT INTO reminder_schedules
           (appointment_id, tenant_id, customer_email, customer_phone, reminder_type, scheduled_for, lead_minutes, status)
         VALUES ${valuesSql.join(', ')}
         ON CONFLICT (appointment_id, reminder_type) WHERE status = 'scheduled'
         DO NOTHING`,
        params
      );
    });
  } catch (err) {
    logger?.error(
      {
        err: err instanceof Error ? err.message : err,
        tenantId,
        appointmentId,
      },
      'Failed to schedule reminders for appointment'
    );
  }
}

/**
 * Persist the caller's chosen reminder lead as a customer preference, so their
 * NEXT booking defaults to it and a reschedule of THIS one rebuilds the reminder
 * at the same lead.
 *
 * Writes the same (customer_id, pref_key) row the voice agent's
 * save_customer_preference tool writes — one storage surface for preferences, so
 * the value also shows up in the caller's prefetched context on their next call
 * and the model can say "same 30-minute heads-up as last time?".
 *
 * Fire-and-forget, like the seeding: a preference write must never fail a booking
 * that already succeeded.
 */
export async function saveReminderLeadPreference(
  withTenantClient: WithTenantClient,
  tenantId: string,
  phone: string,
  minutes: number,
  logger?: FastifyBaseLogger
): Promise<void> {
  const lead = sanitizeLead(minutes);
  if (lead === null) return;
  try {
    const normalized = normalizePhone(phone);
    if (!normalized) return;
    await withTenantClient(tenantId, async (client) => {
      await client.query(
        `INSERT INTO customer_preferences (tenant_id, customer_id, pref_key, pref_value)
         SELECT c.tenant_id, c.customer_id, $3::text, $4::text
           FROM customers c
          WHERE c.tenant_id = $1 AND c.phone = $2
            AND (c.is_deleted IS NULL OR c.is_deleted = false)
         ON CONFLICT (customer_id, pref_key) DO UPDATE
                SET pref_value = EXCLUDED.pref_value, updated_at = now()`,
        [tenantId, normalized, REMINDER_LEAD_PREF_KEY, String(lead)]
      );
    });
  } catch (err) {
    logger?.error(
      { err: err instanceof Error ? err.message : err, tenantId, phone: '[redacted]' },
      'Failed to save reminder-lead preference (booking itself is unaffected)'
    );
  }
}

/**
 * Cancel any pending reminders for an appointment (status='scheduled') and
 * seed a fresh bundle. Used by `/appointments/:id/update` when the operator
 * moves an appointment's start_time — without this, the existing reminder
 * rows fire at the OLD time, surprising both the customer ("why am I getting
 * a 2pm reminder when my appointment was rescheduled to 4pm?") and the
 * reception desk ("the customer just showed up at 2pm and we don't have
 * them").
 *
 * Pending reminders are cancelled (not deleted) so the audit trail is
 * preserved — `status='cancelled'` rows tell the support story when a
 * customer complains they got conflicting reminders.
 *
 * Two-step (cancel-then-seed) rather than one transaction: scheduleFor-
 * Appointment opens its own pool client, and the brief window between
 * cancel and seed (sub-millisecond in practice) doesn't matter for
 * fire-and-forget reminder math. Race with the worker is safe — the worker
 * filters on `status='scheduled' AND scheduled_for <= now()`, so a
 * still-cancelled-not-yet-seeded snapshot just yields zero rows for that
 * appointment.
 */
export async function rescheduleRemindersForAppointment(
  withTenantClient: WithTenantClient,
  tenantId: string,
  appointmentId: string,
  logger?: FastifyBaseLogger,
  // Not usually passed: the reseed re-reads the caller's stored
  // reminder_lead_minutes preference, so their chosen lead survives a
  // reschedule on its own. Present for callers that want to override it.
  opts: { reminderLeadMinutes?: number | null } = {}
): Promise<void> {
  try {
    await withTenantClient(tenantId, async (client) => {
      await client.query(
        `UPDATE reminder_schedules
            SET status = 'cancelled', updated_at = NOW()
          WHERE appointment_id = $1 AND tenant_id = $2 AND status = 'scheduled'`,
        [appointmentId, tenantId]
      );
    });
  } catch (err) {
    logger?.error(
      {
        err: err instanceof Error ? err.message : err,
        tenantId,
        appointmentId,
      },
      'Failed to cancel existing reminders for appointment'
    );
    // Don't bail — still try to seed fresh reminders.
  }
  await scheduleRemindersForAppointment(withTenantClient, tenantId, appointmentId, logger, opts);
}
