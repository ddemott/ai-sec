/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

/**
 * Booking agent tools: what the business sells (service catalog), when it can
 * be booked (availability, scheduling options, open slots), the two booking
 * RPCs, and the caller-owned mutations (my-appointments, cancel, reschedule).
 */
import {
  BookAppointmentSchema,
  BookWithSchedulingSchema,
  CancelAppointmentSchema,
  CheckAvailabilitySchema,
  GetAvailableSlotsSchema,
  GetSchedulingOptionsSchema,
  GetServiceCatalogSchema,
  MyAppointmentsSchema,
  RescheduleAppointmentSchema,
} from './schemas';
import {
  ok,
  fail,
  toolRoute,
  captureRequestedService,
  bookingOutcomeFromAgentError,
  timeToMinutes,
  dateTimeToMinutes,
  minutesToTime,
  mergeIntervals,
  subtractIntervals,
  type AgentToolDeps,
} from './helpers';
import { applyTimezone, toLocalWallClock } from '../../services/timezoneUtils';
import { validateAppointmentTimeRange } from '../../services/appointmentValidation';
import { normalizePhone, isValidPhone } from '../../services/phoneUtils';
import { getOrCreateCustomerByPhone } from '../../services/customerLookup';
import { findNextAvailableSlots } from '../../services/availabilitySearch';
import { resolveServiceForBooking } from '../../services/serviceResolver';
import { getTenantBufferMinutes } from '../../services/tenantBuffer';
import {
  findOverlappingAppointment,
  isOverlapError,
  type AppointmentConflict,
} from '../../services/conflictLookup';
import { syncAppointmentToAll } from '../../services/syncOrchestrator';
import { bookingAttemptsTotal } from '../../services/metrics';
import {
  selectAssignments,
  type ResourceCandidate,
  type EmployeeCandidate,
  type ExistingAppointment,
  type ShiftOverride,
  type Shift,
} from '../../../shared/scheduling';
import {
  scheduleRemindersForAppointment,
  rescheduleRemindersForAppointment,
} from '../../services/reminders/scheduleForAppointment';

export function registerSchedulingRoutes({ app, pool, withTenantClient }: AgentToolDeps): void {
  // get_service_catalog — list public services for the tenant.
  toolRoute(
    app,
    '/agent-tools/service-catalog',
    GetServiceCatalogSchema,
    async (args, reply) => {
      const res = await withTenantClient(args.tenant_id, (client) =>
        client.query(
          `SELECT service_id, name, subtitle, description, duration_minutes, price
           FROM services
          WHERE tenant_id = $1 AND is_deleted = false
          ORDER BY name ASC`,
          [args.tenant_id]
        )
      );
      return ok(reply, { services: res.rows });
    },
    'Failed to fetch service catalog'
  );

  // check_availability — wraps check_availability_with_tz() RPC. The agent
  // sends naive datetimes; we apply the tenant's timezone before the RPC
  // since Postgres can't know which zone "2026-05-01 14:00" is meant in.
  toolRoute(
    app,
    '/agent-tools/check-availability',
    CheckAvailabilitySchema,
    async (args, reply) => {
      if (isNaN(Date.parse(args.start_time)) || isNaN(Date.parse(args.end_time))) {
        return fail(reply, 'Invalid date format provided for availability check.');
      }
      if (new Date(args.end_time) <= new Date(args.start_time)) {
        return fail(reply, 'End time must be after start time.');
      }

      const result = await withTenantClient(args.tenant_id, async (client) => {
        const tz = await client.query<{ timezone: string; default_buffer_minutes: number | null }>(
          `SELECT COALESCE(timezone, 'America/Chicago') AS timezone, default_buffer_minutes FROM tenants WHERE tenant_id = $1`,
          [args.tenant_id]
        );
        const ianaTimezone = tz.rows[0]?.timezone || 'America/Chicago';
        // Buffer makes "is this slot free?" agree with what booking will accept,
        // so the agent never reports a within-buffer time as available.
        const bufferMinutes =
          typeof tz.rows[0]?.default_buffer_minutes === 'number' &&
          tz.rows[0].default_buffer_minutes > 0
            ? tz.rows[0].default_buffer_minutes
            : 0;
        const start = applyTimezone(args.start_time, ianaTimezone);
        const end = applyTimezone(args.end_time, ianaTimezone);
        const rpc = await client.query(
          'SELECT * FROM check_availability_with_tz($1, $2, $3::timestamptz, $4::timestamptz, $5, $6)',
          [args.tenant_id, args.resource_id, start, end, null, bufferMinutes]
        );
        if (rpc.rows.length === 0) {
          throw new Error('check_availability_with_tz returned no result');
        }
        return rpc.rows[0];
      });

      return ok(reply, {
        available: result.available,
        tenant_timezone: result.tenant_timezone,
        local_start: result.local_start,
        local_end: result.local_end,
      });
    },
    'Failed to check availability'
  );

  // book_appointment — upsert customer by phone, then call
  // book_appointment_atomic RPC. The RPC does all the conflict / shift /
  // skill validation server-side; we just translate the (success, err)
  // tuple into the conversational response shape.
  toolRoute(
    app,
    '/agent-tools/book-appointment',
    BookAppointmentSchema,
    async (args, reply) => {
      // Gate: without a valid phone we can't confirm, reschedule, or follow
      // up with the caller. The agent's system prompt hears this message
      // and kicks into the /send-verification-code OTP flow to collect one.
      if (!isValidPhone(args.phone)) {
        return fail(
          reply,
          "Before I book, I'll need a good phone number so we can confirm your appointment and reach you if anything changes. What's the best number to text or call?"
        );
      }
      const normalized = normalizePhone(args.phone)!;
      const timeValidationError = validateAppointmentTimeRange(args.start_time, args.end_time);
      if (timeValidationError) {
        // Hand-rolled response (not fail()) so the agent sees error_code —
        // its prompt branches differently for INVALID_INCREMENT (re-snap to
        // grid) vs INVALID_RANGE (re-ask for end time) vs INVALID_PARAMS
        // (re-ask for both). Same outcome label as the dashboard route.
        bookingAttemptsTotal.inc({ outcome: 'validation_error', source: 'agent' });
        (reply as unknown as { _toolOutcome?: string })._toolOutcome = 'error';
        return reply.status(200).send({
          success: false,
          error: timeValidationError.error,
          error_code: timeValidationError.code,
        });
      }

      // Step 1 — get-or-create the customer in its own transaction so the row
      // persists even if the booking RPC below returns failure. See
      // services/customerLookup.ts for the rationale.
      const customerId = await getOrCreateCustomerByPhone(
        withTenantClient,
        args.tenant_id,
        normalized,
        args.name || 'Valued Customer'
      );

      // Step 2 — booking RPC in a fresh transaction. On overlap, do a follow-up
      // SELECT in the same connection to find the conflicting appointment so
      // the response can carry conflict details (matches /appointments/create
      // contract — Slice 1 of the booking enforcement hardening 2026-05-09).
      const outcome = await withTenantClient(args.tenant_id, async (client) => {
        // Buffer enforced on the agent path only (owner manual booking via
        // /appointments/create passes no buffer → 0 → unrestricted).
        const bufferMinutes = await getTenantBufferMinutes(client, args.tenant_id);
        // The agent supplies the caller's LOCAL wall-clock time (tenant tz), not
        // UTC. Without this, a naive "T15:30:00" is parsed as 15:30 UTC and the
        // appointment lands hours off (10:30 CDT for a 3:30 PM request). Convert
        // via applyTimezone (DST-correct; a no-op if the value already carries a
        // Z/offset) using the tenant's zone — matching check-availability.
        const tzRes = await client.query<{ timezone: string }>(
          `SELECT COALESCE(timezone, 'America/Chicago') AS timezone FROM tenants WHERE tenant_id = $1`,
          [args.tenant_id]
        );
        const ianaTimezone = tzRes.rows[0]?.timezone || 'America/Chicago';
        const startUtc = applyTimezone(args.start_time, ianaTimezone);
        const endUtc = applyTimezone(args.end_time, ianaTimezone);
        // p_assignment_id is TEXT in the current RPC (holds UUID post-Phase 9).
        // Trailing NULLs are p_service_id / p_customer_phone / p_customer_name
        // (unused on this path); the final arg is p_buffer_minutes.
        const rpc = await client.query<{
          success: boolean;
          appointment_id: string | null;
          error_message: string | null;
        }>(
          `SELECT * FROM book_appointment_atomic(
           $1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, NULL, NULL, NULL, $10
         )`,
          [
            args.tenant_id,
            args.resource_id,
            customerId,
            startUtc,
            endUtc,
            args.description,
            args.call_id,
            args.location || null,
            args.employee_id || null,
            bufferMinutes,
          ]
        );
        const result = rpc.rows[0];
        let conflict: AppointmentConflict | null = null;
        if (result && !result.success && isOverlapError(result.error_message)) {
          conflict = await findOverlappingAppointment(client, {
            tenantId: args.tenant_id,
            resourceId: args.resource_id,
            employeeId: args.employee_id || null,
            startTime: args.start_time,
            endTime: args.end_time,
          });
        }
        return { result, conflict };
      });
      const { result, conflict } = outcome;

      if (!result || !result.success) {
        bookingAttemptsTotal.inc({
          outcome: bookingOutcomeFromAgentError(result?.error_message),
          source: 'agent',
        });
        // Hand-rolled response (not fail()) when conflict info is present so
        // the agent + dashboard can read structured fields. Mirrors the
        // book-with-scheduling shape so consumers see one error contract.
        if (conflict) {
          (reply as unknown as { _toolOutcome?: string })._toolOutcome = 'error';
          return reply.status(200).send({
            success: false,
            error: result?.error_message || 'That time is already booked.',
            error_code: 'TIMESLOT_OCCUPIED',
            conflict,
          });
        }
        return fail(reply, result?.error_message || 'Booking failed due to a scheduling conflict.');
      }
      bookingAttemptsTotal.inc({ outcome: 'success', source: 'agent' });
      // Fire-and-forget: schedule confirmation SMS + reminders. Errors are
      // swallowed inside scheduleRemindersForAppointment — a reminder failure
      // must never fail the booking response.
      if (result.appointment_id) {
        void scheduleRemindersForAppointment(
          withTenantClient,
          args.tenant_id,
          result.appointment_id,
          app.log
        );
      }
      return ok(reply, {
        success: true,
        appointment_id: result.appointment_id,
        error_message: null,
      });
    },
    'Failed to book appointment'
  );

  // get_scheduling_options — pure-selector scheduling helper. Loads the
  // tenant's resources/employees/shifts/appointments for the day of the
  // window and runs the shared selectAssignments() algorithm. Diagnostics
  // explain *why* nothing matched when options is empty — the agent uses
  // the reason string to ask a better follow-up question.
  toolRoute(
    app,
    '/agent-tools/scheduling-options',
    GetSchedulingOptionsSchema,
    async (args, reply) => {
      if (isNaN(Date.parse(args.window.from)) || isNaN(Date.parse(args.window.to))) {
        return fail(reply, 'Invalid date format in scheduling window.');
      }
      const windowFrom = new Date(args.window.from);
      const windowTo = new Date(args.window.to);
      if (windowTo <= windowFrom) {
        return fail(reply, 'Window end must be after window start.');
      }
      const dateStr = windowFrom.toISOString().substring(0, 10);

      // Pure availability inquiry → attribute the requested service to this
      // call's voice_session so a caller who never attempts a booking still
      // counts toward abandonment-by-service. Fire-and-forget.
      captureRequestedService(
        withTenantClient,
        args.tenant_id,
        args.call_id,
        args.requirements.serviceType
      );

      const data = await withTenantClient(args.tenant_id, async (client) => {
        // Resources with union of explicit caps + derived from services.
        const resRes = await client.query<{ resource_id: string; capabilities: string[] }>(
          `SELECT r.resource_id,
                ARRAY(
                  SELECT DISTINCT unnest(
                    r.capabilities ||
                    COALESCE(array_agg(DISTINCT cap) FILTER (WHERE cap IS NOT NULL), '{}')
                  )
                ) AS capabilities
           FROM resources r
           LEFT JOIN service_resource sr ON r.resource_id = sr.resource_id
           LEFT JOIN services s ON sr.service_id = s.service_id
           LEFT JOIN LATERAL unnest(s.required_resources) cap ON true
          WHERE r.tenant_id = $1
            AND r.is_active = true
            AND (r.is_deleted IS NULL OR r.is_deleted = false)
          GROUP BY r.resource_id, r.capabilities`,
          [args.tenant_id]
        );

        const empRes = await client.query<{ employee_id: string; skills: string[] }>(
          `SELECT employee_id::text AS employee_id, skills
           FROM employees
          WHERE tenant_id = $1 AND is_active = true
            AND (is_deleted IS NULL OR is_deleted = false)`,
          [args.tenant_id]
        );

        const apptRes = await client.query<{
          resource_id: string;
          start_time: string;
          end_time: string;
        }>(
          `SELECT resource_id, start_time, end_time
           FROM appointments
          WHERE tenant_id = $1
            AND status = 'scheduled'
            AND (is_deleted IS NULL OR is_deleted = false)
            AND start_time < $2::timestamptz
            AND end_time > $3::timestamptz`,
          [args.tenant_id, windowTo.toISOString(), windowFrom.toISOString()]
        );

        // Effective shifts for the date via bulk RPC (single call rather
        // than the N+1 per-employee loop the Deno repo still uses).
        const shiftRes = await client.query<{
          employee_id: string;
          start_time: string | null;
          end_time: string | null;
          is_off: boolean;
        }>(
          `SELECT employee_id::text AS employee_id,
                start_time::text AS start_time,
                end_time::text AS end_time,
                is_off
           FROM get_effective_shifts_bulk($1, $2::date, $2::date)`,
          [args.tenant_id, dateStr]
        );

        const bufferMinutes = await getTenantBufferMinutes(client, args.tenant_id);
        return { resRes, empRes, apptRes, shiftRes, bufferMinutes };
      });

      const resources: ResourceCandidate[] = data.resRes.rows.map((r) => ({
        resource_id: r.resource_id,
        capabilities: r.capabilities || [],
      }));
      const employees: EmployeeCandidate[] = data.empRes.rows.map((e) => ({
        employee_id: e.employee_id,
        skills: e.skills || [],
      }));
      const existingAppointments: ExistingAppointment[] = data.apptRes.rows.map((a) => ({
        resourceId: a.resource_id,
        start: new Date(a.start_time),
        end: new Date(a.end_time),
      }));
      const shiftOverrides: ShiftOverride[] = data.shiftRes.rows
        .filter((s) => s.is_off || (s.start_time && s.end_time))
        .map((s) => ({
          employee_id: s.employee_id,
          shift_date: dateStr,
          start_time: s.start_time,
          end_time: s.end_time,
          is_off: s.is_off,
        }));

      const { options, diagnostics } = selectAssignments({
        requirements: args.requirements,
        window: { from: windowFrom, to: windowTo },
        resources,
        employees,
        shifts: [] as Shift[], // date-based scheduling only; no weekly patterns
        shiftOverrides,
        existingAppointments,
        bufferMinutes: data.bufferMinutes,
      });

      return ok(reply, { options, diagnostics });
    },
    'Failed to compute scheduling options'
  );

  // book_with_scheduling — single-query booking via RPC that does customer
  // upsert + skill/shift matching + conflict check + insert in one tx.
  // Surfaces the RPC's error_code (TIMESLOT_OCCUPIED / NO_SKILLED_EMPLOYEE
  // / EMPLOYEE_NOT_SCHEDULED / NO_AVAILABILITY) so the agent can explain
  // the failure specifically rather than "something went wrong".
  toolRoute(
    app,
    '/agent-tools/book-with-scheduling',
    BookWithSchedulingSchema,
    async (args, reply) => {
      if (isNaN(Date.parse(args.window.from)) || isNaN(Date.parse(args.window.to))) {
        return fail(reply, 'Invalid date format in scheduling window.');
      }
      // Gate: see book-appointment above — same rationale, same message.
      if (!isValidPhone(args.phone)) {
        return fail(
          reply,
          "Before I book, I'll need a good phone number so we can confirm your appointment and reach you if anything changes. What's the best number to text or call?"
        );
      }
      const normalized = normalizePhone(args.phone)!;

      // Step 1 — get-or-create the customer in its own transaction. The RPC
      // would otherwise do this inside its own plpgsql function execution;
      // pulling it out guarantees the customer persists even when the RPC
      // returns NO_AVAILABILITY / TIMESLOT_OCCUPIED / etc., so the next
      // attempt doesn't re-collect the caller's identity. The RPC still
      // receives phone+name in step 2 — its lookup-by-phone will find the
      // customer we just inserted and skip its own INSERT branch.
      await getOrCreateCustomerByPhone(
        withTenantClient,
        args.tenant_id,
        normalized,
        args.name || 'Caller'
      );

      const result = await withTenantClient(args.tenant_id, async (client) => {
        // Resolve the service (falls through to the tenant default when the
        // spoken type doesn't match — so the booking uses a REAL service that
        // carries required_skills, and the RPC can assign a qualified employee
        // instead of failing NO_SKILLED_EMPLOYEE / booking an employee-less slot).
        const resolved = await resolveServiceForBooking(
          client,
          args.tenant_id,
          args.requirements.serviceType
        );
        // Buffer enforced on the agent path; the RPC's internal slot selection
        // skips any resource/employee that would land within the buffer of an
        // existing appointment, so the slot it picks is one booking will accept.
        const bufferMinutes = await getTenantBufferMinutes(client, args.tenant_id);
        // The agent's window is the caller's LOCAL wall-clock (tenant tz), not
        // UTC. `new Date(naive).toISOString()` would read it in the SERVER zone
        // (Railway = UTC) and search the wrong absolute window. Convert via
        // applyTimezone (DST-correct; no-op if already offset-carrying) — same
        // as check-availability + book-appointment.
        const tzRes = await client.query<{ timezone: string }>(
          `SELECT COALESCE(timezone, 'America/Chicago') AS timezone FROM tenants WHERE tenant_id = $1`,
          [args.tenant_id]
        );
        const ianaTimezone = tzRes.rows[0]?.timezone || 'America/Chicago';
        const rpc = await client.query<{
          success: boolean;
          appointment_id: string | null;
          resource_id: string | null;
          resource_name: string | null;
          employee_id: string | null;
          employee_name: string | null;
          booked_start: string | null;
          booked_end: string | null;
          customer_id: string | null;
          error_message: string | null;
          error_code: string | null;
        }>(
          `SELECT * FROM book_with_scheduling_atomic(
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
         )`,
          [
            args.tenant_id,
            normalized,
            args.name || null,
            args.description,
            args.call_id || null,
            args.location || null,
            null, // p_start_time — unused when window provided
            null, // p_end_time
            applyTimezone(args.window.from, ianaTimezone),
            applyTimezone(args.window.to, ianaTimezone),
            // Prefer the resolved service's required_skills (so the RPC assigns
            // a skilled employee); fall back to any the agent explicitly supplied.
            (resolved?.required_skills?.length
              ? resolved.required_skills
              : args.requirements.requiredEmployeeSkills) || [],
            args.requirements.requiredResourceCapabilities || [],
            args.requirements.preferredResourceId || null,
            null, // p_preferred_employee_id
            resolved?.name ?? args.requirements.serviceType ?? null,
            resolved?.duration_minutes ?? 30,
            bufferMinutes, // p_buffer_minutes
          ]
        );
        const row = rpc.rows[0];
        // Response symmetry: the RPC returns booked_start/end as UTC. The agent
        // speaks these back to confirm ("booked for 3:30 PM"), so convert them
        // to the tenant-local wall-clock — otherwise it would confirm the UTC
        // instant (8:30 PM for a 3:30 PM Chicago booking), reintroducing the
        // same tz mismatch on the read-back that we just fixed on the write.
        if (row) {
          if (row.booked_start) row.booked_start = toLocalWallClock(row.booked_start, ianaTimezone);
          if (row.booked_end) row.booked_end = toLocalWallClock(row.booked_end, ianaTimezone);
        }
        return row;
      });

      // Best-effort: record the service the caller was trying to book — runs
      // whether the booking SUCCEEDED or FAILED, so an abandoned booking
      // attempt still shows which service they came for.
      captureRequestedService(
        withTenantClient,
        args.tenant_id,
        args.call_id,
        args.requirements.serviceType
      );

      if (!result || !result.success) {
        // Fetch next-available alternatives so the agent can propose them
        // verbally instead of saying "no availability." Same skill +
        // capability filters as the booking attempt, searches forward up
        // to 24h. Failure to find alternatives leaves next_available
        // empty; the agent prompt handles both shapes.
        const nextAvailable = await withTenantClient(args.tenant_id, async (client) => {
          // Same buffer as the booking attempt, so every suggested alternative
          // is one the agent can actually book under this tenant's buffer.
          const bufferMinutes = await getTenantBufferMinutes(client, args.tenant_id);
          return findNextAvailableSlots(client, {
            tenantId: args.tenant_id,
            fromTime: new Date(args.window.from).toISOString(),
            durationMinutes: 30,
            requiredSkills: args.requirements.requiredEmployeeSkills || [],
            requiredCapabilities: args.requirements.requiredResourceCapabilities || [],
            count: 5,
            bufferMinutes,
          });
        }).catch(() => []);
        bookingAttemptsTotal.inc({
          outcome: bookingOutcomeFromAgentError(result?.error_message, result?.error_code),
          source: 'agent',
        });
        // Hand-rolled response (not ok/fail) so the agent can read
        // error_code + next_available; mirror the success-flag for the
        // tool-call counter so the validation-error branch isn't double-bumped.
        (reply as unknown as { _toolOutcome?: string })._toolOutcome = 'error';
        return reply.status(200).send({
          success: false,
          error: result?.error_message || 'No available scheduling options',
          error_code: result?.error_code || 'NO_AVAILABILITY',
          next_available: nextAvailable,
        });
      }

      bookingAttemptsTotal.inc({ outcome: 'success', source: 'agent' });
      if (result.appointment_id) {
        void scheduleRemindersForAppointment(
          withTenantClient,
          args.tenant_id,
          result.appointment_id,
          app.log
        );
      }
      return ok(reply, {
        success: true,
        appointment_id: result.appointment_id,
        resource_name: result.resource_name,
        employee_name: result.employee_name,
        booked_start: result.booked_start,
        booked_end: result.booked_end,
        error_message: null,
      });
    },
    'Failed to book with scheduling'
  );

  // get_available_slots — computes open windows for a service on a given
  // date. Single SQL union-all pulls service + shifts + appointments in
  // one round trip; interval math then merges shift coverage and subtracts
  // bookings. Returns a *spoken* string because the agent relays it
  // verbatim to the caller.
  toolRoute(
    app,
    '/agent-tools/available-slots',
    GetAvailableSlotsSchema,
    async (args, reply) => {
      // Pure availability inquiry → attribute the requested service to this
      // call's voice_session so a caller who never attempts a booking still
      // counts toward abandonment-by-service. Fire-and-forget.
      captureRequestedService(withTenantClient, args.tenant_id, args.call_id, args.service_type);

      // Resolve the service FIRST — falls through to the tenant default when
      // the caller's spoken type doesn't match a real service, so "a meeting" /
      // "consulting" / anything never dead-ends with "couldn't find a service".
      // Null only when the tenant has no bookable service at all.
      const service = await withTenantClient(args.tenant_id, (client) =>
        resolveServiceForBooking(client, args.tenant_id, args.service_type)
      );

      // Format date for speech ("Wednesday, April 2")
      const dateObj = new Date(args.date + 'T12:00:00');
      const dayName = dateObj.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });

      if (!service) {
        return ok(
          reply,
          `I'm not able to pull up our booking options right now. Would you like to leave a message and I'll have Dale get back to you?`
        );
      }

      const data = await withTenantClient(args.tenant_id, async (client) => {
        const res = await client.query<{
          source: 'shift' | 'appointment';
          start_time: string | null;
          end_time: string | null;
        }>(
          `WITH active_employees AS (
             SELECT employee_id FROM employees
              WHERE tenant_id = $1 AND is_active = true
                AND (is_deleted IS NULL OR is_deleted = false)
           ),
           effective_shifts AS (
             SELECT DISTINCT es.start_time::text AS start_time, es.end_time::text AS end_time
               FROM active_employees ae
               JOIN employee_schedule es
                 ON es.employee_id = ae.employee_id
                AND es.tenant_id = $1
                AND es.shift_date = $2::date
                AND es.is_off = false
                AND es.start_time IS NOT NULL
           ),
           day_appointments AS (
             SELECT start_time::text, end_time::text
               FROM appointments
              WHERE tenant_id = $1 AND status = 'scheduled'
                AND (is_deleted IS NULL OR is_deleted = false)
                AND start_time::date = $2::date
           )
           SELECT 'shift'::text AS source, start_time, end_time FROM effective_shifts
           UNION ALL
           SELECT 'appointment'::text, start_time, end_time FROM day_appointments
           ORDER BY source, start_time`,
          [args.tenant_id, args.date]
        );
        const shifts: Array<{ start_time: string; end_time: string }> = [];
        const appointments: Array<{ start_time: string; end_time: string }> = [];
        for (const row of res.rows) {
          if (row.source === 'shift' && row.start_time && row.end_time) {
            shifts.push({ start_time: row.start_time, end_time: row.end_time });
          } else if (row.source === 'appointment' && row.start_time && row.end_time) {
            appointments.push({ start_time: row.start_time, end_time: row.end_time });
          }
        }
        // Buffer so the openings we read aloud match what booking will accept.
        const bufferMinutes = await getTenantBufferMinutes(client, args.tenant_id);
        return { shifts, appointments, bufferMinutes };
      });

      const { name: serviceName, duration_minutes, price } = service;
      const serviceInfo =
        price && price > 0
          ? `${serviceName} takes about ${duration_minutes} minutes and costs $${price.toFixed(0)}.`
          : `${serviceName} takes about ${duration_minutes} minutes.`;

      if (data.shifts.length === 0) {
        return ok(
          reply,
          `${serviceInfo} Unfortunately, we don't have anyone scheduled to work on ${dayName}. Would you like to try a different day?`
        );
      }

      const coverage = mergeIntervals(
        data.shifts.map((s) => ({
          start: timeToMinutes(s.start_time),
          end: timeToMinutes(s.end_time),
        }))
      );
      // Expand each booking by the tenant's buffer on both sides before
      // subtracting it from shift coverage, so the open windows we offer keep
      // the required gap around existing appointments (matches the booking RPC).
      const booked = data.appointments.map((a) => ({
        start: dateTimeToMinutes(a.start_time) - data.bufferMinutes,
        end: dateTimeToMinutes(a.end_time) + data.bufferMinutes,
      }));
      const open = subtractIntervals(coverage, booked);
      const usable = open.filter((slot) => slot.end - slot.start >= duration_minutes);

      // If today, filter out past times.
      const now = new Date();
      const isToday = args.date === now.toLocaleDateString('en-CA');
      const currentMinutes = isToday ? now.getHours() * 60 + now.getMinutes() : 0;
      const futureSlots = isToday
        ? usable
            .filter((s) => s.end > currentMinutes)
            .map((s) => ({ start: Math.max(s.start, currentMinutes), end: s.end }))
            .filter((s) => s.end - s.start >= duration_minutes)
        : usable;

      if (futureSlots.length === 0) {
        return ok(
          reply,
          `${serviceInfo} Unfortunately, we're fully booked on ${dayName}. Would you like to try a different day?`
        );
      }

      const slotStrings = futureSlots.map((s) => {
        if (s.start === coverage[0]?.start && s.end === coverage[coverage.length - 1]?.end) {
          return `all day from ${minutesToTime(s.start)} to ${minutesToTime(s.end)}`;
        }
        return `${minutesToTime(s.start)} to ${minutesToTime(s.end)}`;
      });
      const openHours = `${minutesToTime(coverage[0].start)} to ${minutesToTime(
        coverage[coverage.length - 1].end
      )}`;
      const slotsText =
        slotStrings.length === 1
          ? slotStrings[0]
          : slotStrings.slice(0, -1).join(', ') + ', and ' + slotStrings[slotStrings.length - 1];

      return ok(
        reply,
        `${serviceInfo} On ${dayName}, our hours are ${openHours}. We have openings ${slotsText}. What time works best for you?`
      );
    },
    'Failed to compute available slots'
  );

  // my-appointments — return upcoming scheduled appointments for the calling phone.
  // Phone is server-injected (never from LLM) to prevent cross-caller enumeration.
  toolRoute(
    app,
    '/agent-tools/my-appointments',
    MyAppointmentsSchema,
    async (args, reply) => {
      const normalized = normalizePhone(args.phone);
      if (!normalized) return fail(reply, 'Invalid phone number');

      const rows = await withTenantClient(args.tenant_id, async (client) => {
        return client.query<{
          appointment_id: string;
          start_time: string;
          end_time: string;
          description: string | null;
          status: string;
          service_name: string | null;
          employee_name: string | null;
        }>(
          `SELECT a.appointment_id, a.start_time, a.end_time, a.description, a.status,
                  s.name AS service_name,
                  e.name AS employee_name
           FROM appointments a
           JOIN customers c ON a.customer_id = c.customer_id
           LEFT JOIN services s ON a.service_id = s.service_id AND s.tenant_id = a.tenant_id
           LEFT JOIN employees e ON a.employee_id = e.employee_id AND e.tenant_id = a.tenant_id
           WHERE c.tenant_id = $1 AND c.phone = $2
             AND a.status = 'scheduled' AND a.start_time > NOW()
             AND (a.is_deleted IS NULL OR a.is_deleted = false)
             AND (c.is_deleted IS NULL OR c.is_deleted = false)
           ORDER BY a.start_time
           LIMIT 5`,
          [args.tenant_id, normalized]
        );
      });

      return ok(reply, { appointments: rows.rows });
    },
    'Failed to fetch appointments'
  );

  // cancel-appointment — soft-cancel a scheduled appointment owned by the caller.
  // Ownership verified by phone match so the LLM can never cancel another caller's
  // appointment even if it hallucinates a UUID.
  toolRoute(
    app,
    '/agent-tools/cancel-appointment',
    CancelAppointmentSchema,
    async (args, reply) => {
      const normalized = normalizePhone(args.phone);
      if (!normalized) return fail(reply, 'Invalid phone number');

      const result = await withTenantClient(args.tenant_id, async (client) => {
        return client.query<{ appointment_id: string }>(
          `UPDATE appointments a SET status = 'canceled'
           FROM customers c
           WHERE a.appointment_id = $1
             AND a.tenant_id = $2
             AND a.customer_id = c.customer_id
             AND c.phone = $3
             AND a.status = 'scheduled'
             AND a.start_time > NOW()
             AND (a.is_deleted IS NULL OR a.is_deleted = false)
           RETURNING a.appointment_id`,
          [args.appointment_id, args.tenant_id, normalized]
        );
      });

      if (result.rows.length === 0) {
        return fail(
          reply,
          "I couldn't find that appointment under your number, or it may already be past or canceled."
        );
      }

      // Fire-and-forget calendar sync so the slot opens up immediately.
      syncAppointmentToAll(pool, args.tenant_id, args.appointment_id, 'delete', app.log);

      return ok(reply, { cancelled: true, appointment_id: args.appointment_id });
    },
    'Failed to cancel appointment'
  );

  // reschedule-appointment — move a scheduled appointment to a new time.
  // Phone ownership verified server-side (LLM can't move another caller's appointment).
  // GiST exclusion constraints reject double-bookings at the DB layer (23P01).
  toolRoute(
    app,
    '/agent-tools/reschedule-appointment',
    RescheduleAppointmentSchema,
    async (args, reply) => {
      const normalized = normalizePhone(args.phone);
      if (!normalized) return fail(reply, 'Invalid phone number');

      const timeError = validateAppointmentTimeRange(args.new_start_time, args.new_end_time);
      if (timeError) return fail(reply, timeError.error);

      if (new Date(args.new_start_time) <= new Date()) {
        return fail(reply, 'New appointment time must be in the future.');
      }

      try {
        const result = await withTenantClient(args.tenant_id, async (client) => {
          return client.query<{ appointment_id: string }>(
            `UPDATE appointments a SET start_time = $4, end_time = $5
             FROM customers c
             WHERE a.appointment_id = $1
               AND a.tenant_id = $2
               AND a.customer_id = c.customer_id
               AND c.tenant_id = $2
               AND c.phone = $3
               AND a.status = 'scheduled'
               AND a.start_time > NOW()
               AND (a.is_deleted IS NULL OR a.is_deleted = false)
             RETURNING a.appointment_id`,
            [
              args.appointment_id,
              args.tenant_id,
              normalized,
              args.new_start_time,
              args.new_end_time,
            ]
          );
        });

        if (result.rows.length === 0) {
          return fail(
            reply,
            "I couldn't find that appointment under your number, or it may already be past or canceled."
          );
        }
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === '23P01') {
          return fail(reply, 'That time slot is already booked. Please choose a different time.');
        }
        throw err;
      }

      // Fire-and-forget: update calendar sync + reschedule reminders.
      syncAppointmentToAll(pool, args.tenant_id, args.appointment_id, 'update', app.log);
      void rescheduleRemindersForAppointment(
        withTenantClient,
        args.tenant_id,
        args.appointment_id,
        app.log
      );

      return ok(reply, { rescheduled: true, appointment_id: args.appointment_id });
    },
    'Failed to reschedule appointment'
  );
}
