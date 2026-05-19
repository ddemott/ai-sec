import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { type Client } from "pg";
import { getRootClient, createTenant, skipIfDbDown } from "./test-utils";

/**
 * Schema + behavior coverage for the per-tenant notification preferences
 * columns (`sms_enabled`, `email_enabled`) added in migration
 * `20260513000001_tenants_notification_preferences.sql`.
 *
 * Three things pinned:
 *   1. Columns exist with the expected type + default + nullability.
 *   2. New tenants default to BOTH channels enabled (opt-in by default,
 *      matching the InMemoryTenantConfigService's legacy defaults).
 *   3. An explicit UPDATE flips the value cleanly — proves the column is
 *      writable, not just a constant.
 *
 * Why pin this with a real-DB test: PostgresTenantConfigService already
 * references these column names in its SELECT statements; if a future
 * "schema cleanup" drops them again (the columns were ALSO missing
 * pre-2026-05-13, so this is a real failure mode), every subsequent call
 * to getTenantConfigAsync would 500. The column-existence assertion is
 * the safety net.
 */

describe("tenants notification preferences columns", () => {
    let root: Client;
    let dbAvailable = true;
    beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

    beforeAll(async () => {
        try {
            root = await getRootClient();
        } catch (err) {
            dbAvailable = false;
            // eslint-disable-next-line no-console
            console.warn("[tenants-notification-prefs.test] Skipping DB tests - connection failed", err);
        }
    });

    afterAll(async () => {
        if (dbAvailable && root) await root.end();
    });

    it("sms_enabled exists as BOOLEAN NOT NULL DEFAULT TRUE", async () => {
        // WHO: schema introspection for the new column.
        // WHAT: information_schema reports data_type='boolean',
        //       is_nullable='NO', column_default='true'.
        // WHEN: every schema migration; lock-down test for the
        //       2026-05-13 migration.
        // WHERE: tenants.sms_enabled — column added by migration
        //        20260513000001.
        // WHY: PostgresTenantConfigService.rowToConfig reads
        //      `row.sms_enabled !== false` (defaulting to true when
        //      undefined). Locking BOOLEAN NOT NULL DEFAULT TRUE at the
        //      schema level means even a path that INSERTs without
        //      naming this column still produces a sensible row.
        if (!dbAvailable) return;

        const result = await root.query(
            `SELECT data_type, is_nullable, column_default
               FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'tenants'
                AND column_name = 'sms_enabled'`
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].data_type).toBe("boolean");
        expect(result.rows[0].is_nullable).toBe("NO");
        expect(result.rows[0].column_default).toBe("true");
    });

    it("email_enabled exists as BOOLEAN NOT NULL DEFAULT TRUE", async () => {
        // WHO: schema introspection mirror of sms_enabled.
        // WHAT: identical assertion shape for the email channel column.
        // WHEN/WHERE/WHY: see sms_enabled test above — separate `it()`
        //      so a regression on EXACTLY ONE column names exactly that
        //      column in the CI output.
        if (!dbAvailable) return;

        const result = await root.query(
            `SELECT data_type, is_nullable, column_default
               FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'tenants'
                AND column_name = 'email_enabled'`
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].data_type).toBe("boolean");
        expect(result.rows[0].is_nullable).toBe("NO");
        expect(result.rows[0].column_default).toBe("true");
    });

    it("HAPPY: a freshly created tenant defaults BOTH channels to TRUE", async () => {
        // WHO: any path that INSERTs into tenants without naming the
        //      notification-prefs columns. Today that's every /register
        //      call + the bootstrap helper + seed.sql.
        // WHAT: the inserted row has sms_enabled=true AND email_enabled=true,
        //       inherited from the column defaults.
        // WHEN: every new tenant onboarding.
        // WHERE: the column DEFAULT clause from the migration.
        // WHY: pins the OPT-IN BY DEFAULT semantic. A regression that
        //      flipped the default to false would silently disable
        //      reminders for every new tenant — exactly the kind of
        //      latent UX failure the migration's comment warns against.
        if (!dbAvailable) return;

        const tenantId = await createTenant(root, "PrefsDefault", "automotive");
        const result = await root.query<{ sms_enabled: boolean; email_enabled: boolean }>(
            "SELECT sms_enabled, email_enabled FROM tenants WHERE tenant_id = $1",
            [tenantId]
        );
        expect(result.rows[0].sms_enabled).toBe(true);
        expect(result.rows[0].email_enabled).toBe(true);

        // Cleanup
        await root.query("DELETE FROM service_employee WHERE tenant_id = $1", [tenantId]).catch(() => {});
        await root.query("DELETE FROM tenants WHERE tenant_id = $1", [tenantId]);
    });

    it("HAPPY: explicit UPDATE flips a channel cleanly", async () => {
        // WHO: a tenant owner toggling SMS off via a future Settings UI,
        //      or ops running a manual SQL UPDATE for a tenant on a
        //      problem provider.
        // WHAT: UPDATE tenants SET sms_enabled = FALSE WHERE tenant_id
        //       = X persists; subsequent SELECT shows FALSE.
        // WHEN: any actual write to these columns. Today no UI calls
        //       this, but the columns are writable.
        // WHERE: the standard ALTER TABLE … ADD COLUMN preserves
        //        normal UPDATE semantics.
        // WHY: pins that the columns are NOT inadvertently marked as
        //      generated/computed/etc. — a regression that adds a
        //      CHECK or GENERATED ALWAYS clause would fail this.
        if (!dbAvailable) return;

        const tenantId = await createTenant(root, "PrefsFlip", "automotive");
        await root.query(
            "UPDATE tenants SET sms_enabled = FALSE, email_enabled = FALSE WHERE tenant_id = $1",
            [tenantId]
        );

        const result = await root.query<{ sms_enabled: boolean; email_enabled: boolean }>(
            "SELECT sms_enabled, email_enabled FROM tenants WHERE tenant_id = $1",
            [tenantId]
        );
        expect(result.rows[0].sms_enabled).toBe(false);
        expect(result.rows[0].email_enabled).toBe(false);

        // Cleanup
        await root.query("DELETE FROM service_employee WHERE tenant_id = $1", [tenantId]).catch(() => {});
        await root.query("DELETE FROM tenants WHERE tenant_id = $1", [tenantId]);
    });
});
