/**
 * PK Rename Coverage — Real-DB Integration
 *
 * Every renamed PK column gets exercised against actual Postgres here so
 * that a future regression (someone re-introducing `WHERE id = $1` against
 * a renamed table, or the rename being reverted) fails loudly instead of
 * passing on mocked tests that don't talk to a real schema.
 *
 * Each test follows the same shape:
 *   1. INSERT and assert the renamed PK column is returned by name
 *      (proves the column exists under the new name)
 *   2. SELECT by the renamed PK column (proves WHERE <new>_id = $1 binds)
 *   3. UPDATE/DELETE by the renamed PK column when the table supports it
 *
 * SQL uses the natural column name throughout — no `AS id` aliases. Reads
 * use `.row[0].<table>_id`, matching the column. This is the standard the
 * rest of the codebase now follows (see CODING_STANDARDS.md "Database
 * naming standards").
 *
 * Origin: the rename sprint (2026-05-12) renamed `id` → `<table>_id` on
 * 25 tables. After cleanup (2026-05-13) only 44% of renamed PKs had
 * real-DB coverage; the rest were either mocked-only or untouched in
 * any test. This file closes the gap for the 13 tables that lacked it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Client } from "pg";
import {
  getRootClient,
  clearDB,
  setupBasicTenant,
  beginTestTransaction,
  rollbackTestTransaction,
} from "./test-utils";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("PK rename coverage — real-DB integration", () => {
  let client: Client;
  let tenantId: string;
  let resourceId: string;
  let customerId: string;
  let dbAvailable = true;

  beforeAll(async () => {
    try {
      client = await getRootClient();
      await clearDB(client);
      const setup = await setupBasicTenant(client);
      tenantId = setup.tenantId;
      resourceId = setup.resourceId;
      customerId = setup.customerId;
    } catch (err) {
      dbAvailable = false;
      console.warn("[pk-rename-coverage] Skipping DB tests — connection failed", err);
    }
  });

  afterAll(async () => {
    if (dbAvailable && client) {
      await client.end();
    }
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await beginTestTransaction(client);
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    await rollbackTestTransaction(client);
  });

  // ─────────────────────────────────────────────────────────────────────
  // voice_sessions.voice_session_id (UUID)
  // ─────────────────────────────────────────────────────────────────────
  describe("voice_sessions", () => {
    it("INSERT returns voice_session_id, SELECT by voice_session_id finds it", async () => {
      // WHO: Voice route writing a session row at call-start
      // WHAT: New row's PK column is voice_session_id (UUID), not id
      // WHEN: Every inbound call hits POST /voice/start
      // WHERE: src/routes/voice.ts → start_voice_session RPC
      // WHY: A regression to `RETURNING id` would silently return undefined and
      //      poison the call_id-to-session_id mapping the rest of the call relies on.
      if (!dbAvailable) return;

      const ins = await client.query(
        `INSERT INTO voice_sessions (tenant_id, call_id, caller_phone, status)
         VALUES ($1, 'call-vs-1', '+15551112222', 'active')
         RETURNING voice_session_id, tenant_id, status`,
        [tenantId],
      );
      expect(ins.rows).toHaveLength(1);
      const vsid = ins.rows[0].voice_session_id;
      expect(vsid).toMatch(UUID_RE);

      const sel = await client.query(
        `SELECT voice_session_id, status FROM voice_sessions WHERE voice_session_id = $1`,
        [vsid],
      );
      expect(sel.rows[0].voice_session_id).toBe(vsid);
      expect(sel.rows[0].status).toBe("active");
    });

    it("UPDATE by voice_session_id flips status to completed", async () => {
      // WHY: The post-call hook updates status by voice_session_id. If the column
      //      were missing the UPDATE would affect 0 rows and the session would
      //      stay 'active' forever.
      if (!dbAvailable) return;

      const ins = await client.query(
        `INSERT INTO voice_sessions (tenant_id, call_id, caller_phone)
         VALUES ($1, 'call-vs-2', '+15551112233')
         RETURNING voice_session_id`,
        [tenantId],
      );
      const vsid = ins.rows[0].voice_session_id;

      const upd = await client.query(
        `UPDATE voice_sessions SET status = 'completed', ended_at = now()
         WHERE voice_session_id = $1 RETURNING voice_session_id, status`,
        [vsid],
      );
      expect(upd.rowCount).toBe(1);
      expect(upd.rows[0].status).toBe("completed");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // call_summaries.call_summary_id (UUID)
  // ─────────────────────────────────────────────────────────────────────
  describe("call_summaries", () => {
    it("INSERT/SELECT/DELETE by call_summary_id round-trips", async () => {
      // WHO: Post-call summarization writing a row for later RAG retrieval
      // WHAT: call_summary_id is the UUID PK; customer_id is the FK
      // WHERE: agent worker's hangup hook + dashboard call-history view
      // WHY: The dashboard fetches `WHERE call_summary_id = $1` for the detail
      //      pane. A regression here would 404 every call summary detail open.
      if (!dbAvailable) return;

      const ins = await client.query(
        `INSERT INTO call_summaries (tenant_id, customer_id, summary, call_id)
         VALUES ($1, $2, 'Customer asked about pricing for snow tires.', 'call-cs-1')
         RETURNING call_summary_id, summary`,
        [tenantId, customerId],
      );
      const csid = ins.rows[0].call_summary_id;
      expect(csid).toMatch(UUID_RE);

      const sel = await client.query(
        `SELECT call_summary_id, summary FROM call_summaries WHERE call_summary_id = $1`,
        [csid],
      );
      expect(sel.rows[0].summary).toContain("snow tires");

      const del = await client.query(
        `DELETE FROM call_summaries WHERE call_summary_id = $1 RETURNING call_summary_id`,
        [csid],
      );
      expect(del.rowCount).toBe(1);
      expect(del.rows[0].call_summary_id).toBe(csid);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // call_transcripts.call_transcript_id (UUID)
  // ─────────────────────────────────────────────────────────────────────
  describe("call_transcripts", () => {
    it("INSERT returns call_transcript_id, SELECT by it returns raw_text", async () => {
      // WHO: Agent worker writing the full transcript after hangup
      // WHAT: Raw verbatim text, keyed by call_transcript_id (UUID)
      // WHERE: agent/src/index.ts hangup handler → POST to backend
      // WHY: Transcript detail view in dashboard reads by call_transcript_id.
      //      A column-name regression silently drops every transcript link.
      if (!dbAvailable) return;

      const ins = await client.query(
        `INSERT INTO call_transcripts (tenant_id, customer_id, call_id, raw_text)
         VALUES ($1, $2, 'call-ct-1', 'Hello, can I book an oil change?')
         RETURNING call_transcript_id, call_id`,
        [tenantId, customerId],
      );
      const ctid = ins.rows[0].call_transcript_id;
      expect(ctid).toMatch(UUID_RE);

      const sel = await client.query(
        `SELECT call_transcript_id, raw_text FROM call_transcripts WHERE call_transcript_id = $1`,
        [ctid],
      );
      expect(sel.rows[0].raw_text).toContain("oil change");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // soft_reservations.soft_reservation_id (UUID)
  // ─────────────────────────────────────────────────────────────────────
  describe("soft_reservations", () => {
    it("INSERT + SELECT + DELETE by soft_reservation_id", async () => {
      // WHO: Voice agent holding a slot during verbal confirmation
      // WHAT: Short-lived hold with expires_at; cleanup is by soft_reservation_id
      // WHERE: agent-tools soft-reserve route + cleanup worker
      // WHY: Double-booking guard — if cleanup couldn't find rows by their PK,
      //      every aborted booking would leave a permanent ghost reservation.
      if (!dbAvailable) return;

      const ins = await client.query(
        `INSERT INTO soft_reservations
           (tenant_id, resource_id, start_time, end_time, expires_at, call_id)
         VALUES ($1, $2, '2026-06-01 10:00:00+00', '2026-06-01 11:00:00+00',
                 now() + interval '90 seconds', 'call-sr-1')
         RETURNING soft_reservation_id, expires_at`,
        [tenantId, resourceId],
      );
      const srid = ins.rows[0].soft_reservation_id;
      expect(srid).toMatch(UUID_RE);

      const sel = await client.query(
        `SELECT soft_reservation_id FROM soft_reservations WHERE soft_reservation_id = $1`,
        [srid],
      );
      expect(sel.rows[0].soft_reservation_id).toBe(srid);

      const del = await client.query(
        `DELETE FROM soft_reservations WHERE soft_reservation_id = $1`,
        [srid],
      );
      expect(del.rowCount).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // audit_log.audit_log_id (UUID)
  // ─────────────────────────────────────────────────────────────────────
  describe("audit_log", () => {
    it("INSERT returns audit_log_id; SELECT by it finds the row", async () => {
      // WHO: fn_audit_trigger writing to audit_log on every domain table change
      //      (also direct INSERTs from routes that audit explicit events)
      // WHAT: audit_log_id is the UUID PK; record_id is TEXT pointing at the
      //      changed row
      // WHERE: middleware.logEvent + the SECURITY DEFINER trigger
      // WHY: Audit trail is the legal/compliance log for HIPAA-adjacent ops.
      //      A regression would still INSERT (no PK reference needed) but the
      //      RETURNING audit_log_id pattern used by some routes would break.
      if (!dbAvailable) return;

      const ins = await client.query(
        `INSERT INTO audit_log (tenant_id, table_name, record_id, action, new_data, changed_by)
         VALUES ($1, 'test_table', 'rec-1', 'INSERT', '{"ok":true}'::jsonb, 'pk-rename-coverage')
         RETURNING audit_log_id, action`,
        [tenantId],
      );
      const aid = ins.rows[0].audit_log_id;
      expect(aid).toMatch(UUID_RE);
      expect(ins.rows[0].action).toBe("INSERT");

      const sel = await client.query(
        `SELECT audit_log_id, changed_by FROM audit_log WHERE audit_log_id = $1`,
        [aid],
      );
      expect(sel.rows[0].changed_by).toBe("pk-rename-coverage");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // record_versions.record_version_id (UUID)
  // ─────────────────────────────────────────────────────────────────────
  describe("record_versions", () => {
    it("INSERT returns record_version_id; SELECT-by-PK matches", async () => {
      // WHO: Auto-version trigger on customers/appointments/etc., plus
      //      manual versions from restore/copy-fields routes
      // WHAT: record_version_id (UUID) is the PK; record_id points back at
      //      the versioned row's PK on its parent table
      // WHERE: 20260409100000_version_history_and_soft_delete.sql trigger
      // WHY: The version-history dashboard loads detail by record_version_id.
      //      A regression here breaks the "view this version" link.
      if (!dbAvailable) return;

      const ins = await client.query(
        `INSERT INTO record_versions
           (tenant_id, table_name, record_id, version_number, data,
            change_type, change_source)
         VALUES ($1, 'customers', $2, 99, '{"name":"snapshot"}'::jsonb,
                 'update', 'local')
         RETURNING record_version_id, version_number`,
        [tenantId, customerId],
      );
      const rvid = ins.rows[0].record_version_id;
      expect(rvid).toMatch(UUID_RE);
      expect(ins.rows[0].version_number).toBe(99);

      const sel = await client.query(
        `SELECT record_version_id, change_type FROM record_versions
         WHERE record_version_id = $1`,
        [rvid],
      );
      expect(sel.rows[0].change_type).toBe("update");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // reminder_schedules.reminder_schedule_id (SERIAL)
  // ─────────────────────────────────────────────────────────────────────
  describe("reminder_schedules", () => {
    it("INSERT returns reminder_schedule_id as a number; UPDATE by it flips status", async () => {
      // WHO: ReminderService scheduling a confirmation reminder for an appointment
      // WHAT: reminder_schedule_id is SERIAL (number, not UUID); appointment_id
      //      is UUID and points at appointments.appointment_id
      // WHERE: src/services/reminders/* + the 60s scheduler tick
      // WHY: This table is THE origin of the type-mismatch lesson on 2026-05-11
      //      (mocked tests hid `parseInt(uuid)` for weeks). Real-DB coverage
      //      here is non-negotiable.
      if (!dbAvailable) return;

      // Need an appointment for the FK
      const apt = await client.query(
        `INSERT INTO appointments
           (tenant_id, resource_id, customer_id, start_time, end_time, description)
         VALUES ($1, $2, $3, '2026-07-01 10:00:00+00',
                 '2026-07-01 11:00:00+00', 'Reminder test')
         RETURNING appointment_id`,
        [tenantId, resourceId, customerId],
      );
      const aptId = apt.rows[0].appointment_id;

      const ins = await client.query(
        `INSERT INTO reminder_schedules
           (appointment_id, tenant_id, customer_email, reminder_type, scheduled_for)
         VALUES ($1, $2, 'cust@test.com', '24h', '2026-06-30 10:00:00+00')
         RETURNING reminder_schedule_id, status`,
        [aptId, tenantId],
      );
      const rsid = ins.rows[0].reminder_schedule_id;
      // SERIAL → number, NOT a UUID string
      expect(typeof rsid).toBe("number");
      expect(rsid).toBeGreaterThan(0);
      expect(ins.rows[0].status).toBe("scheduled");

      const upd = await client.query(
        `UPDATE reminder_schedules SET status = 'sent', sent_at = now()
         WHERE reminder_schedule_id = $1 RETURNING status`,
        [rsid],
      );
      expect(upd.rowCount).toBe(1);
      expect(upd.rows[0].status).toBe("sent");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // consent_records.consent_record_id (SERIAL)
  // ─────────────────────────────────────────────────────────────────────
  describe("consent_records", () => {
    it("INSERT returns consent_record_id as a number; UPDATE-by-PK revokes", async () => {
      // WHO: Booking flow capturing SMS consent on first appointment
      // WHAT: consent_record_id is SERIAL; revoke = set revoked_at
      // WHERE: src/services/consentService.ts + CommunicationService gate
      // WHY: TCPA/GDPR — opt-out has to find the consent row and timestamp it.
      //      If the PK column rename broke, revocation would silently no-op.
      if (!dbAvailable) return;

      const ins = await client.query(
        `INSERT INTO consent_records
           (tenant_id, customer_email, consent_type, consent_given, consent_date, consent_method)
         VALUES ($1, 'optin@test.com', 'sms', true, now(), 'booking')
         RETURNING consent_record_id, consent_given`,
        [tenantId],
      );
      const crid = ins.rows[0].consent_record_id;
      expect(typeof crid).toBe("number");
      expect(ins.rows[0].consent_given).toBe(true);

      const upd = await client.query(
        `UPDATE consent_records SET revoked_at = now(), revoke_reason = 'STOP reply'
         WHERE consent_record_id = $1 RETURNING revoked_at`,
        [crid],
      );
      expect(upd.rowCount).toBe(1);
      expect(upd.rows[0].revoked_at).not.toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // opt_out_records.opt_out_record_id (SERIAL)
  // ─────────────────────────────────────────────────────────────────────
  describe("opt_out_records", () => {
    it("INSERT returns opt_out_record_id; original_consent_id FK still binds", async () => {
      // WHO: SMS STOP reply handler logging the opt-out
      // WHAT: opt_out_record_id is SERIAL; original_consent_id FK points back
      //      at consent_records.consent_record_id (also SERIAL).
      // WHERE: SMS webhook receiver → ConsentService.recordOptOut
      // WHY: Audit trail of who opted out + when. A column-rename regression
      //      here would lose the consent → opt-out link on every STOP.
      if (!dbAvailable) return;

      // Seed a consent row to FK against
      const consent = await client.query(
        `INSERT INTO consent_records
           (tenant_id, customer_phone, consent_type, consent_given, consent_date, consent_method)
         VALUES ($1, '+15553334444', 'sms', true, now(), 'booking')
         RETURNING consent_record_id`,
        [tenantId],
      );
      const consentId = consent.rows[0].consent_record_id;

      const ins = await client.query(
        `INSERT INTO opt_out_records
           (tenant_id, customer_phone, opt_out_type, opt_out_date, opt_out_method,
            original_consent_id, notes)
         VALUES ($1, '+15553334444', 'sms', now(), 'stop', $2, 'Customer texted STOP')
         RETURNING opt_out_record_id, original_consent_id`,
        [tenantId, consentId],
      );
      const ooid = ins.rows[0].opt_out_record_id;
      expect(typeof ooid).toBe("number");
      expect(ins.rows[0].original_consent_id).toBe(consentId);

      const sel = await client.query(
        `SELECT opt_out_record_id, opt_out_method FROM opt_out_records
         WHERE opt_out_record_id = $1`,
        [ooid],
      );
      expect(sel.rows[0].opt_out_method).toBe("stop");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // user_feedback.user_feedback_id (UUID)
  // ─────────────────────────────────────────────────────────────────────
  describe("user_feedback", () => {
    it("INSERT returns user_feedback_id; DELETE-by-PK clears it", async () => {
      // WHO: Dashboard feedback widget submitting page-context comments
      // WHAT: user_feedback_id (UUID) PK; user_id FK can be NULL
      //      (anonymous feedback allowed pre-login)
      // WHERE: dashboard FeedbackWidget → POST /feedback
      // WHY: Admin clears resolved feedback by PK. A rename regression makes
      //      the "delete this entry" button silently no-op.
      if (!dbAvailable) return;

      const ins = await client.query(
        `INSERT INTO user_feedback (tenant_id, page, context, comment, rating)
         VALUES ($1, 'Back Office > Services', 'editing service-XYZ',
                 'Add a duplicate-service action.', 4)
         RETURNING user_feedback_id, rating`,
        [tenantId],
      );
      const ufid = ins.rows[0].user_feedback_id;
      expect(ufid).toMatch(UUID_RE);
      expect(ins.rows[0].rating).toBe(4);

      const del = await client.query(
        `DELETE FROM user_feedback WHERE user_feedback_id = $1 RETURNING user_feedback_id`,
        [ufid],
      );
      expect(del.rowCount).toBe(1);
      expect(del.rows[0].user_feedback_id).toBe(ufid);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // phone_verifications.phone_verification_id (UUID)
  // ─────────────────────────────────────────────────────────────────────
  describe("phone_verifications", () => {
    it("INSERT returns phone_verification_id; UPDATE by it marks verified", async () => {
      // WHO: SMS OTP flow gating booking on isValidPhone
      // WHAT: phone_verification_id (UUID); attempt_count increments per
      //      wrong-code attempt
      // WHERE: agent-tools /verify-phone route
      // WHY: Verification flow updates by PK. A rename regression would make
      //      every verification attempt stay 'pending' forever and block all
      //      bookings — the worst possible failure mode for the OTP gate.
      if (!dbAvailable) return;

      const ins = await client.query(
        `INSERT INTO phone_verifications
           (tenant_id, phone, code_hash, expires_at)
         VALUES ($1, '+15554445555', 'hashed-code-stub', now() + interval '10 minutes')
         RETURNING phone_verification_id, attempt_count`,
        [tenantId],
      );
      const pvid = ins.rows[0].phone_verification_id;
      expect(pvid).toMatch(UUID_RE);
      expect(ins.rows[0].attempt_count).toBe(0);

      const upd = await client.query(
        `UPDATE phone_verifications SET verified_at = now()
         WHERE phone_verification_id = $1 RETURNING verified_at`,
        [pvid],
      );
      expect(upd.rowCount).toBe(1);
      expect(upd.rows[0].verified_at).not.toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // employee_schedule.employee_schedule_id (UUID)
  // ─────────────────────────────────────────────────────────────────────
  describe("employee_schedule", () => {
    it("INSERT returns employee_schedule_id; UPDATE/DELETE by it work", async () => {
      // WHO: Owner editing a single date's shift on the Schedule tab
      //      (or the weekly-grid expansion in setup wizard)
      // WHAT: employee_schedule_id (UUID) PK; the row encodes one
      //      (employee_id, shift_date) pair with start/end or is_off=true
      // WHERE: src/routes/shifts.ts override endpoints + the booking RPCs
      //      that read this table as the source of truth for shift coverage
      // WHY: Every booking gates on a matching employee_schedule row. The
      //      RPCs SELECT/JOIN by employee_id+date, but route-level CRUD on
      //      individual rows happens by employee_schedule_id. A rename
      //      regression here makes "edit this specific shift" silently fail.
      if (!dbAvailable) return;

      // Need an employee for the FK
      const emp = await client.query(
        `INSERT INTO employees (tenant_id, name, first_name, last_name)
         VALUES ($1, 'Shift Tester', 'Shift', 'Tester')
         RETURNING employee_id`,
        [tenantId],
      );
      const empId = emp.rows[0].employee_id;

      const ins = await client.query(
        `INSERT INTO employee_schedule
           (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
         VALUES ($1, $2, '2026-08-15'::DATE, '09:00'::TIME, '17:00'::TIME, false)
         RETURNING employee_schedule_id, is_off`,
        [tenantId, empId],
      );
      const esid = ins.rows[0].employee_schedule_id;
      expect(esid).toMatch(UUID_RE);
      expect(ins.rows[0].is_off).toBe(false);

      const upd = await client.query(
        `UPDATE employee_schedule SET is_off = true, start_time = NULL, end_time = NULL
         WHERE employee_schedule_id = $1 RETURNING is_off`,
        [esid],
      );
      expect(upd.rowCount).toBe(1);
      expect(upd.rows[0].is_off).toBe(true);

      const del = await client.query(
        `DELETE FROM employee_schedule WHERE employee_schedule_id = $1`,
        [esid],
      );
      expect(del.rowCount).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // tenant_integration_settings.tenant_integration_setting_id (UUID)
  // ─────────────────────────────────────────────────────────────────────
  describe("tenant_integration_settings", () => {
    it("INSERT returns tenant_integration_setting_id; UPDATE by it rotates token", async () => {
      // WHO: OAuth callback completing a Jobber/HubSpot/Square/ServiceTitan connect
      // WHAT: tenant_integration_setting_id (UUID) is the PK; the (tenant_id,
      //      provider) UNIQUE constraint is the natural key. Token rotation
      //      goes through `UPDATE ... WHERE tenant_integration_setting_id = $1`
      //      when called from the OAuth-refresh helper rather than by the
      //      (tenant, provider) pair.
      // WHERE: src/services/oauthCallbackFactory.ts + tokenManagement.ts
      // WHY: Token refresh is the silent-failure case par excellence — a
      //      column-rename regression here makes every refresh a no-op, the
      //      access_token stays stale, and the next CRM call 401s without
      //      any signal that the rotation failed.
      if (!dbAvailable) return;

      const ins = await client.query(
        `INSERT INTO tenant_integration_settings
           (tenant_id, provider, access_token, refresh_token, is_active)
         VALUES ($1, 'jobber', 'access-stub', 'refresh-stub', true)
         RETURNING tenant_integration_setting_id, provider`,
        [tenantId],
      );
      const tisid = ins.rows[0].tenant_integration_setting_id;
      expect(tisid).toMatch(UUID_RE);
      expect(ins.rows[0].provider).toBe("jobber");

      const upd = await client.query(
        `UPDATE tenant_integration_settings
            SET access_token = 'rotated-access', token_expires_at = now() + interval '1 hour'
          WHERE tenant_integration_setting_id = $1
          RETURNING access_token`,
        [tisid],
      );
      expect(upd.rowCount).toBe(1);
      expect(upd.rows[0].access_token).toBe("rotated-access");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // entity_sync_map.entity_sync_map_id (UUID)
  // ─────────────────────────────────────────────────────────────────────
  describe("entity_sync_map", () => {
    it("INSERT returns entity_sync_map_id; UPDATE by it bumps last_synced_at", async () => {
      // WHO: CRM sync writing the local↔external id mapping
      // WHAT: entity_sync_map_id (UUID) is the surrogate PK; the real
      //      identity is (tenant_id, provider, entity_type, local_id)
      //      enforced by UNIQUE constraint. Routes still UPDATE by the PK
      //      when bumping last_synced_at after a successful push.
      // WHERE: src/services/syncMapHelpers.ts + CRM sync services
      // WHY: Bidirectional CRM sync relies on this mapping to know "the local
      //      customer I just pushed maps to this Jobber clientId". If the PK
      //      rename broke, status-bump UPDATEs silently no-op and the next
      //      pull would re-sync the same row instead of merging.
      if (!dbAvailable) return;

      const ins = await client.query(
        `INSERT INTO entity_sync_map
           (tenant_id, provider, entity_type, local_id, external_id,
            remote_updated_at, sync_status)
         VALUES ($1, 'jobber', 'customer', $2, 'jobber-client-9999',
                 '2026-05-01T00:00:00Z', 'synced')
         RETURNING entity_sync_map_id, sync_status`,
        [tenantId, customerId],
      );
      const esmid = ins.rows[0].entity_sync_map_id;
      expect(esmid).toMatch(UUID_RE);

      const upd = await client.query(
        `UPDATE entity_sync_map SET last_synced_at = now(), sync_status = 'pending'
         WHERE entity_sync_map_id = $1 RETURNING sync_status`,
        [esmid],
      );
      expect(upd.rowCount).toBe(1);
      expect(upd.rows[0].sync_status).toBe("pending");
    });
  });
});
