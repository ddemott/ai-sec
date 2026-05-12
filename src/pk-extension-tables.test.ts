import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "pg";
import {
    getRootClient,
    clearDB,
    createTenant,
    createResource,
    createCustomerFull,
    createAppointment,
} from "./test-utils";

// PK naming convention carve-out — 1:1 extension tables.
//
// CODING_STANDARDS.md documents three allowed PK shapes:
//   1. Surrogate `<table_singular>_id UUID PRIMARY KEY` (the dominant case)
//   2. Junction composite `(left_id, right_id)` — relationship IS identity
//   3. **1:1 extension** — parent's PK reused as the child's PK, where the
//      table holds at-most-one row per parent
//
// This file pins shape #3 against the real schema. Two tables qualify today:
//   * `tenant_calendar_settings (tenant_id PRIMARY KEY REFERENCES tenants)`
//   * `appointment_sync_map (appointment_id PRIMARY KEY REFERENCES appointments)`
//
// Tests assert: PK column matches parent's PK name, FK with ON DELETE CASCADE,
// UUID type, RLS enabled + FORCED, "at most one row per parent" enforced at
// the PK level, cascade-delete actually fires.
//
// Why pin this with a test: the previous PK rename sprint (pilots 1–27)
// surfaced multiple stale-column bugs at the schema-introspection boundary
// (`auto_version_trigger`, `fn_audit_trigger`, `notify_n8n_on_appointment`,
// `create_default_resources` — all referenced `NEW.id`/`OLD.id` after parent
// rename). The same class of latent bug could re-emerge if someone "fixes" the
// non-standard PK shape by adding a surrogate UUID without grasping the
// at-most-one-row invariant. This test fails loud if either table's shape
// drifts away from the documented carve-out.

describe("1:1 extension table PK convention — schema shape", () => {
    let root: Client;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            root = await getRootClient();
        } catch (err) {
            dbAvailable = false;
            // eslint-disable-next-line no-console
            console.warn("[pk-extension-tables.test] Skipping DB tests - connection failed", err);
        }
    });

    afterAll(async () => {
        if (dbAvailable && root) await root.end();
    });

    describe("tenant_calendar_settings", () => {
        it("has tenant_id as its single-column primary key", async () => {
            // WHO: schema introspection on tenant_calendar_settings
            // WHAT: pg_index lookup of the primary-key column(s) returns exactly ['tenant_id']
            // WHEN: every schema migration / every fresh test_db bootstrap
            // WHERE: public.tenant_calendar_settings — the calendar-integration extension table for tenants
            // WHY: pins the carve-out documented in CODING_STANDARDS.md → "1:1 extension tables". A regression
            //      that adds a surrogate `tenant_calendar_setting_id UUID PRIMARY KEY` (silently demoting
            //      tenant_id to a non-PK column) would weaken the "at-most-one calendar integration per tenant"
            //      invariant from a PK-level guarantee to a separate UNIQUE constraint that could later be dropped.
            if (!dbAvailable) return;

            const result = await root.query(`
                SELECT a.attname
                FROM pg_index i
                JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                WHERE i.indrelid = 'public.tenant_calendar_settings'::regclass
                  AND i.indisprimary
                ORDER BY a.attnum
            `);
            expect(result.rows.map((r: { attname: string }) => r.attname)).toEqual(["tenant_id"]);
        });

        it("has tenant_id typed as UUID", async () => {
            // WHO: schema introspection on tenant_calendar_settings.tenant_id
            // WHAT: information_schema reports the column's data_type as 'uuid'
            // WHEN: schema validation
            // WHERE: public.tenant_calendar_settings.tenant_id
            // WHY: TypeScript types model UUID columns as `string` (CODING_STANDARDS.md → TypeScript type matching).
            //      A drift to TEXT/VARCHAR would silently break the string assumption; SERIAL would force a
            //      type-system change cascade. Locking the type at the schema level keeps the TS<->DB contract honest.
            if (!dbAvailable) return;

            const result = await root.query(`
                SELECT data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'tenant_calendar_settings'
                  AND column_name = 'tenant_id'
            `);
            expect(result.rows[0]?.data_type).toBe("uuid");
        });

        it("tenant_id is a foreign key to tenants(tenant_id) with ON DELETE CASCADE", async () => {
            // WHO: schema introspection on the tenant_calendar_settings → tenants FK
            // WHAT: pg_constraint row exists with referenced relation = 'tenants', referenced column = 'tenant_id',
            //       and confdeltype = 'c' (cascade)
            // WHEN: schema validation
            // WHERE: pg_constraint for FKs declared on tenant_calendar_settings
            // WHY: the PK-as-FK shape is THE mechanism enforcing the 1:1 invariant. Without CASCADE, deleting a
            //      tenant would leave orphan calendar-settings rows; with the FK missing entirely, the table
            //      could hold rows for non-existent tenants. Both would silently break tenant offboarding under
            //      GDPR-style data deletion (the same class of bug pilot 24's audit caught for employees/services).
            if (!dbAvailable) return;

            const result = await root.query(`
                SELECT
                    c.confrelid::regclass::text AS referenced_table,
                    a.attname AS referenced_column,
                    c.confdeltype
                FROM pg_constraint c
                JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = ANY(c.confkey)
                WHERE c.conrelid = 'public.tenant_calendar_settings'::regclass
                  AND c.contype = 'f'
                ORDER BY a.attnum
            `);
            // Single-column FK → exactly one row from the JOIN.
            expect(result.rows).toHaveLength(1);
            expect(result.rows[0].referenced_table).toBe("tenants");
            expect(result.rows[0].referenced_column).toBe("tenant_id");
            expect(result.rows[0].confdeltype).toBe("c"); // 'c' = CASCADE
        });

        it("has RLS enabled and FORCED", async () => {
            // WHO: schema introspection of pg_class.relrowsecurity + relforcerowsecurity flags
            // WHAT: both flags true (RLS active for all callers including table owners)
            // WHEN: schema validation; the migration history shows ALTER TABLE … FORCE ROW LEVEL SECURITY
            //       applied in 20260323000000_force_rls_single_pool.sql
            // WHERE: pg_class row for tenant_calendar_settings
            // WHY: this table stores OAuth access_token + refresh_token. RLS off (or not FORCED) is a hard
            //      cross-tenant data leak — any tenant connection could pull every tenant's calendar tokens.
            //      FORCED matters because table owners (the migration role) bypass RLS by default unless forced.
            if (!dbAvailable) return;

            const result = await root.query(`
                SELECT relrowsecurity, relforcerowsecurity
                FROM pg_class
                WHERE oid = 'public.tenant_calendar_settings'::regclass
            `);
            expect(result.rows[0].relrowsecurity).toBe(true);
            expect(result.rows[0].relforcerowsecurity).toBe(true);
        });
    });

    describe("appointment_sync_map", () => {
        it("has appointment_id as its single-column primary key", async () => {
            // WHO: schema introspection on appointment_sync_map
            // WHAT: pg_index lookup of the primary-key column(s) returns exactly ['appointment_id']
            // WHEN: schema validation
            // WHERE: public.appointment_sync_map — the external-event-id extension table for appointments
            // WHY: pins the carve-out for the second 1:1 extension table. The "at-most-one external event link
            //      per appointment" invariant is what prevents duplicate Google Calendar / Outlook events being
            //      created on appointment edits (the calendarSync code looks up by appointment_id, never by a
            //      surrogate). Adding a surrogate UUID would weaken this guarantee + add a column nothing reads.
            if (!dbAvailable) return;

            const result = await root.query(`
                SELECT a.attname
                FROM pg_index i
                JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                WHERE i.indrelid = 'public.appointment_sync_map'::regclass
                  AND i.indisprimary
                ORDER BY a.attnum
            `);
            expect(result.rows.map((r: { attname: string }) => r.attname)).toEqual(["appointment_id"]);
        });

        it("has appointment_id typed as UUID", async () => {
            // WHO: schema introspection on appointment_sync_map.appointment_id
            // WHAT: information_schema reports the column's data_type as 'uuid'
            // WHEN: schema validation
            // WHERE: public.appointment_sync_map.appointment_id
            // WHY: must match `appointments.appointment_id` UUID type (TS<->DB contract). A type mismatch
            //      would surface as a runtime CAST failure on INSERT — exactly the class of bug that the
            //      ReminderSchedule.appointment_id `number`-vs-UUID lie caused (RESOLVED 2026-05-11).
            if (!dbAvailable) return;

            const result = await root.query(`
                SELECT data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'appointment_sync_map'
                  AND column_name = 'appointment_id'
            `);
            expect(result.rows[0]?.data_type).toBe("uuid");
        });

        it("appointment_id is a foreign key to appointments(appointment_id) with ON DELETE CASCADE", async () => {
            // WHO: schema introspection on the appointment_sync_map → appointments FK
            // WHAT: pg_constraint row exists with referenced relation = 'appointments', referenced column =
            //       'appointment_id', and confdeltype = 'c' (cascade)
            // WHEN: schema validation
            // WHERE: pg_constraint for FKs declared on appointment_sync_map
            // WHY: when an appointment is hard-deleted, the external-event link must follow. Without CASCADE,
            //      we'd retain orphan rows pointing at non-existent appointments — the calendarSync delete
            //      path would then try to delete an event that's already gone (or never existed), surfacing
            //      Google/Outlook 404s in logs. Pilot 14 confirmed the FK still targets appointments after the
            //      `appointments.id → appointment_id` rename; this test makes that the contract.
            if (!dbAvailable) return;

            const result = await root.query(`
                SELECT
                    c.confrelid::regclass::text AS referenced_table,
                    a.attname AS referenced_column,
                    c.confdeltype
                FROM pg_constraint c
                JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = ANY(c.confkey)
                WHERE c.conrelid = 'public.appointment_sync_map'::regclass
                  AND c.contype = 'f'
                ORDER BY a.attnum
            `);
            // Single-column FK → exactly one row from the JOIN.
            expect(result.rows).toHaveLength(1);
            expect(result.rows[0].referenced_table).toBe("appointments");
            expect(result.rows[0].referenced_column).toBe("appointment_id");
            expect(result.rows[0].confdeltype).toBe("c"); // 'c' = CASCADE
        });

        it("has RLS enabled and FORCED", async () => {
            // WHO: schema introspection of pg_class.relrowsecurity + relforcerowsecurity flags
            // WHAT: both flags true
            // WHEN: schema validation; migration history shows FORCE applied in 20260323000000_force_rls_single_pool.sql
            // WHERE: pg_class row for appointment_sync_map
            // WHY: this table joins via appointments to derive tenant_id (the RLS policy is EXISTS-based on
            //      appointments rather than a direct tenant_id column). A regression that disables RLS or
            //      drops FORCE would let any tenant read any other tenant's external-event ids — a low-severity
            //      but real cross-tenant leak (event ids are external system identifiers; combined with provider
            //      they could enable enumeration probes against Google/Outlook APIs).
            if (!dbAvailable) return;

            const result = await root.query(`
                SELECT relrowsecurity, relforcerowsecurity
                FROM pg_class
                WHERE oid = 'public.appointment_sync_map'::regclass
            `);
            expect(result.rows[0].relrowsecurity).toBe(true);
            expect(result.rows[0].relforcerowsecurity).toBe(true);
        });
    });
});

describe("1:1 extension table PK convention — runtime behavior", () => {
    let root: Client;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            root = await getRootClient();
        } catch (err) {
            dbAvailable = false;
            // eslint-disable-next-line no-console
            console.warn("[pk-extension-tables.test] Skipping DB tests - connection failed", err);
        }
    });

    afterAll(async () => {
        if (dbAvailable && root) await root.end();
    });

    beforeEach(async () => {
        if (!dbAvailable) return;
        await clearDB(root);
        // tenant_calendar_settings + appointment_sync_map aren't in clearDB's
        // truncate list — explicitly clean them too so each test starts empty.
        // (TRUNCATE CASCADE on tenants/appointments would normally cascade here,
        // but clearDB CASCADEs each table independently; defensive truncate.)
        await root.query("TRUNCATE tenant_calendar_settings CASCADE").catch(() => { /* table may not exist */ });
        await root.query("TRUNCATE appointment_sync_map CASCADE").catch(() => { /* table may not exist */ });
    });

    describe("tenant_calendar_settings", () => {
        it("HAPPY: one calendar-settings row per tenant inserts cleanly", async () => {
            // WHO: a tenant connecting Google Calendar for the first time via POST /calendar/google/callback
            // WHAT: INSERT INTO tenant_calendar_settings (tenant_id, provider, …) succeeds; the row is queryable
            // WHEN: every initial OAuth-success callback for a tenant that has no existing calendar integration
            // WHERE: src/routes/calendar.ts:70 / :145 / :203 — the three INSERT call sites
            // WHY: the dominant calendar-onboarding happy path. If this breaks, OAuth callback succeeds at the
            //      provider but the local row write fails → token gets dropped → next sync attempt has no
            //      credentials → user sees "calendar disconnected" with no useful error. Pin the happy path
            //      explicitly so a future schema change can't regress it silently.
            if (!dbAvailable) return;

            const tenantId = await createTenant(root, "ExtensionHappy1", "automotive");
            await root.query(
                `INSERT INTO tenant_calendar_settings (tenant_id, provider, external_calendar_id, access_token)
                 VALUES ($1, 'google', 'cal-abc-123', 'token-xyz')`,
                [tenantId]
            );

            const result = await root.query(
                "SELECT tenant_id, provider, external_calendar_id FROM tenant_calendar_settings WHERE tenant_id = $1",
                [tenantId]
            );
            expect(result.rows).toHaveLength(1);
            expect(result.rows[0].tenant_id).toBe(tenantId);
            expect(result.rows[0].provider).toBe("google");
            expect(result.rows[0].external_calendar_id).toBe("cal-abc-123");
        });

        it("SAD: a second row for the same tenant raises unique_violation (PK enforces at-most-one)", async () => {
            // WHO: a hypothetical bug where the same tenant tries to insert a calendar-settings row twice
            //      (e.g., a doubled OAuth callback, a missing ON CONFLICT clause, a race in the upsert path)
            // WHAT: second INSERT raises Postgres unique_violation (SQLSTATE 23505) — the PK constraint
            //       refuses to accept a duplicate tenant_id
            // WHEN: regression check — without this guarantee, two competing OAuth completions could leave
            //       the table with two rows for one tenant, and SELECT … LIMIT 1 ordering becomes
            //       implementation-defined (race-dependent which provider's tokens win)
            // WHERE: tenant_calendar_settings primary-key constraint
            // WHY: this is the LITERAL invariant the 1:1 extension shape exists to enforce. If a future
            //      migration accidentally swaps the PK for a surrogate UUID without also adding UNIQUE
            //      on tenant_id, this test fails loud — the schema would silently accept duplicates and
            //      the contract documented in CODING_STANDARDS.md → "1:1 extension tables" would be broken.
            if (!dbAvailable) return;

            const tenantId = await createTenant(root, "ExtensionSad1", "automotive");
            await root.query(
                `INSERT INTO tenant_calendar_settings (tenant_id, provider, external_calendar_id)
                 VALUES ($1, 'google', 'cal-first')`,
                [tenantId]
            );

            await expect(
                root.query(
                    `INSERT INTO tenant_calendar_settings (tenant_id, provider, external_calendar_id)
                     VALUES ($1, 'outlook', 'cal-second')`,
                    [tenantId]
                )
            ).rejects.toMatchObject({ code: "23505" }); // SQLSTATE 23505 = unique_violation
        });

        it("HAPPY: deleting the parent tenant cascades the calendar-settings row", async () => {
            // WHO: super-admin offboarding a tenant via DELETE /tenants/:id
            // WHAT: deleting the tenants row also deletes the matching tenant_calendar_settings row;
            //       a follow-up SELECT against tenant_calendar_settings returns zero rows
            // WHEN: tenant deletion / data-deletion request / test cleanup
            // WHERE: ON DELETE CASCADE on tenant_calendar_settings.tenant_id FK
            // WHY: without CASCADE this DELETE would either fail (FK violation) or leave orphan rows holding
            //      OAuth tokens for a deleted tenant — a real GDPR retention problem at beta scale. The
            //      employees/services migration (20260511000000) closed the same class of bug there;
            //      this test pins the equivalent guarantee for tenant_calendar_settings.
            if (!dbAvailable) return;

            const tenantId = await createTenant(root, "ExtensionCascade1", "automotive");
            await root.query(
                `INSERT INTO tenant_calendar_settings (tenant_id, provider, external_calendar_id)
                 VALUES ($1, 'google', 'cal-cascade-test')`,
                [tenantId]
            );
            const before = await root.query(
                "SELECT 1 FROM tenant_calendar_settings WHERE tenant_id = $1",
                [tenantId]
            );
            expect(before.rowCount).toBe(1);

            await root.query("DELETE FROM tenants WHERE tenant_id = $1", [tenantId]);

            const after = await root.query(
                "SELECT 1 FROM tenant_calendar_settings WHERE tenant_id = $1",
                [tenantId]
            );
            expect(after.rowCount).toBe(0);
        });
    });

    describe("appointment_sync_map", () => {
        it("HAPPY: one sync_map row per appointment inserts cleanly", async () => {
            // WHO: calendarSync.ts pushing a newly-booked appointment to Google Calendar
            // WHAT: INSERT INTO appointment_sync_map (appointment_id, external_event_id, provider, …) succeeds;
            //       the external event id is queryable for later update/delete sync
            // WHEN: every initial calendar push after appointment creation
            // WHERE: src/services/calendarSync.ts:91 — the INSERT call site
            // WHY: dominant calendar-push happy path. If this breaks, the appointment is booked locally and
            //      pushed to Google, but the local sync_map row write fails → later appointment edits cannot
            //      find the external event id → updates silently create duplicate events instead of updating
            //      the original. Pin the happy path so a schema change can't regress it.
            if (!dbAvailable) return;

            const tenantId = await createTenant(root, "ExtensionHappy2", "automotive");
            const resourceId = await createResource(root, tenantId, "Bay 1");
            const customerId = await createCustomerFull(root, tenantId, "+15550002222", "Bob");
            const apptId = await createAppointment(
                root, tenantId, resourceId, customerId,
                "2026-06-01 10:00:00+00", "2026-06-01 11:00:00+00",
                "Test appointment"
            );

            await root.query(
                `INSERT INTO appointment_sync_map (appointment_id, external_event_id, provider)
                 VALUES ($1, 'google-event-abc', 'google')`,
                [apptId]
            );

            const result = await root.query(
                "SELECT appointment_id, external_event_id, provider FROM appointment_sync_map WHERE appointment_id = $1",
                [apptId]
            );
            expect(result.rows).toHaveLength(1);
            expect(result.rows[0].appointment_id).toBe(apptId);
            expect(result.rows[0].external_event_id).toBe("google-event-abc");
            expect(result.rows[0].provider).toBe("google");
        });

        it("SAD: a second row for the same appointment raises unique_violation (PK enforces at-most-one)", async () => {
            // WHO: a hypothetical bug where calendarSync attempts to insert a second external-event link
            //      for the same appointment (e.g., a doubled push, a race between Google and Outlook adapters)
            // WHAT: second INSERT raises Postgres unique_violation (SQLSTATE 23505)
            // WHEN: regression check — without this guarantee, an appointment edit looking up its external
            //       event id via "SELECT external_event_id … LIMIT 1" would race-pick one provider's id
            //       while the other provider's event keeps drifting out of sync
            // WHERE: appointment_sync_map primary-key constraint
            // WHY: this is the literal invariant of the 1:1 extension shape — at most one external event
            //      per appointment. Today the calendar-sync layer pushes to one provider per tenant (via
            //      tenant_calendar_settings.provider), so collisions shouldn't happen in practice — but
            //      the PK is the load-bearing guard if the multi-provider design ever lands. Drift here =
            //      silent dual-event creation, a hard-to-debug shape mismatch with external calendars.
            if (!dbAvailable) return;

            const tenantId = await createTenant(root, "ExtensionSad2", "automotive");
            const resourceId = await createResource(root, tenantId, "Bay 2");
            const customerId = await createCustomerFull(root, tenantId, "+15550003333", "Carol");
            const apptId = await createAppointment(
                root, tenantId, resourceId, customerId,
                "2026-06-02 10:00:00+00", "2026-06-02 11:00:00+00",
                "Test appointment 2"
            );
            await root.query(
                `INSERT INTO appointment_sync_map (appointment_id, external_event_id, provider)
                 VALUES ($1, 'google-first', 'google')`,
                [apptId]
            );

            await expect(
                root.query(
                    `INSERT INTO appointment_sync_map (appointment_id, external_event_id, provider)
                     VALUES ($1, 'outlook-second', 'outlook')`,
                    [apptId]
                )
            ).rejects.toMatchObject({ code: "23505" });
        });

        it("HAPPY: deleting the parent appointment cascades the sync_map row", async () => {
            // WHO: an appointment delete (hard delete, not soft delete) via /appointments/:id route or
            //      tenant-cascade offboarding
            // WHAT: deleting the appointments row also deletes the matching appointment_sync_map row;
            //       SELECT against appointment_sync_map for that appointment_id returns zero rows
            // WHEN: appointment hard-delete / tenant deletion (cascades through appointments → sync_map)
            // WHERE: ON DELETE CASCADE on appointment_sync_map.appointment_id FK
            // WHY: without CASCADE, hard-deleting an appointment would either fail with an FK violation or
            //      leave orphan rows pointing at non-existent appointment ids. The calendarSync delete path
            //      would then try to delete external events for vanished appointments — surfacing as
            //      Google/Outlook 404s in production logs. Pin the cascade so schema regressions surface here.
            if (!dbAvailable) return;

            const tenantId = await createTenant(root, "ExtensionCascade2", "automotive");
            const resourceId = await createResource(root, tenantId, "Bay 3");
            const customerId = await createCustomerFull(root, tenantId, "+15550004444", "Dan");
            const apptId = await createAppointment(
                root, tenantId, resourceId, customerId,
                "2026-06-03 10:00:00+00", "2026-06-03 11:00:00+00",
                "Test appointment 3"
            );
            await root.query(
                `INSERT INTO appointment_sync_map (appointment_id, external_event_id, provider)
                 VALUES ($1, 'event-cascade-test', 'google')`,
                [apptId]
            );
            const before = await root.query(
                "SELECT 1 FROM appointment_sync_map WHERE appointment_id = $1",
                [apptId]
            );
            expect(before.rowCount).toBe(1);

            await root.query("DELETE FROM appointments WHERE appointment_id = $1", [apptId]);

            const after = await root.query(
                "SELECT 1 FROM appointment_sync_map WHERE appointment_id = $1",
                [apptId]
            );
            expect(after.rowCount).toBe(0);
        });
    });
});
