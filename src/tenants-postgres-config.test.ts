import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { type Client, Pool } from "pg";
import { PostgresTenantConfigService } from "./services/tenants/index.js";
import { getRootClient, createTenant, ROOT_DB_URL, skipIfDbDown } from "./test-utils.js";

/**
 * Real-DB integration coverage for `PostgresTenantConfigService`.
 *
 * Two classes of bug this file guards against:
 *   1. Column-mapping drift. Before 2026-05-13, `rowToConfig` + the three
 *      SQL statements referenced four columns that don't exist on
 *      `tenants` (`id`, `business_name`, `owner_email`, `phone`). Every
 *      async call would 500 against real Postgres. Pinned by the
 *      "maps every column" + "phone is undefined for null owner_phone"
 *      + "getBusinessName returns name" + "updateTenantConfig writes
 *      correct columns" tests below.
 *   2. Cache-correctness drift. The service has a 1-minute per-tenant
 *      TTL that holds the email/reminder hot path off the DB. Pinned by
 *      the dedicated "cache behavior" describe block.
 *
 * The bug stayed latent before 2026-05-13 because (a) the only callers
 * reached the service via a sync method that returned from cache and
 * never hit the DB; (b) every unit test of the email / reminder
 * consumers used mocked `TenantConfigService` instances. The interface
 * is now async-only, so a real DB roundtrip happens on every cold
 * lookup — these tests guard the DB-touching path.
 */

describe("PostgresTenantConfigService against real schema", () => {
    let root: Client;
    let pool: Pool;
    let service: PostgresTenantConfigService;
    let dbAvailable = true;
    beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));
    const tenantsToClean: string[] = [];

    beforeAll(async () => {
        try {
            root = await getRootClient();
            pool = new Pool({ connectionString: ROOT_DB_URL, max: 3 });
            service = new PostgresTenantConfigService(pool);
        } catch (err) {
            dbAvailable = false;
            // eslint-disable-next-line no-console
            console.warn("[tenants-postgres-config.test] Skipping DB tests - connection failed", err);
        }
    });

    afterAll(async () => {
        if (!dbAvailable) return;
        for (const id of tenantsToClean) {
            await root.query("DELETE FROM tenants WHERE tenant_id = $1", [id]).catch(() => {});
        }
        await pool.end();
        await root.end();
    });

    it("HAPPY: getTenantConfig maps every column the service exposes", async () => {
        // WHO: any caller — emailService / smsService / ReminderProcessor
        //      / a future Settings UI.
        // WHAT: the row returned reflects the actual `tenants` row —
        //       `id` from `tenant_id`, `phone` from `owner_phone`, no
        //       references to nonexistent `business_name` / `owner_email`.
        // WHEN: any time PostgresTenantConfigService is wired against a
        //       real DB connection (prod, beta, integration test).
        // WHERE: rowToConfig + the SELECT in getTenantConfig at
        //        src/services/tenants/index.ts.
        // WHY: this is the single test that catches the pre-2026-05-13
        //      column-mismatch class of bug. If anyone re-introduces a
        //      reference to `business_name` or `owner_email`, the query
        //      will error here with `column "..." does not exist` instead
        //      of silently 500-ing the first time a real reminder fires.
        if (!dbAvailable) return;

        const tenantId = await createTenant(root, "PgConfigHappy", "automotive", "America/Chicago");
        tenantsToClean.push(tenantId);
        await root.query("UPDATE tenants SET owner_phone = $2 WHERE tenant_id = $1", [tenantId, "+15551234567"]);

        service.clearCache();
        const config = await service.getTenantConfig(tenantId);

        expect(config).not.toBeNull();
        expect(config!.tenantId).toBe(tenantId);
        expect(config!.name).toBe("PgConfigHappy");
        expect(config!.phone).toBe("+15551234567");
        expect(config!.timezone).toBe("America/Chicago");
        expect(config!.settings?.smsEnabled).toBe(true);
        expect(config!.settings?.emailEnabled).toBe(true);
    });

    it("HAPPY: a freshly created tenant with no owner_phone surfaces phone as undefined", async () => {
        // WHO: the /register flow + the bootstrap helper — neither sets
        //      owner_phone at create time.
        // WHAT: `phone` on the returned config is `undefined`, not the
        //       string "null".
        // WHEN: every new-tenant onboarding before the first owner-phone
        //       edit.
        // WHERE: the `row.owner_phone ?? undefined` mapping in rowToConfig.
        // WHY: pins the null→undefined normalization. Without it, a
        //      downstream `if (config.phone)` test passes when the value
        //      is the literal string "null", surfacing "null" in
        //      customer-facing email footers.
        if (!dbAvailable) return;

        const tenantId = await createTenant(root, "PgConfigNullPhone", "automotive");
        tenantsToClean.push(tenantId);

        service.clearCache();
        const config = await service.getTenantConfig(tenantId);

        expect(config!.phone).toBeUndefined();
    });

    it("HAPPY: getNotificationPreferences honors the per-tenant flags", async () => {
        // WHO: ReminderProcessor + CommunicationService — both consult
        //      notification prefs before dispatching SMS/email.
        // WHAT: flipping `email_enabled = FALSE` on the row flows through
        //       to `prefs.emailEnabled === false`; the SMS flag stays
        //       true; contactInfo.phone reflects owner_phone.
        // WHEN: every send-attempt for a tenant that has opted out of
        //       one channel.
        // WHERE: getNotificationPreferences → getTenantConfig →
        //        rowToConfig in this service.
        // WHY: pins the consent-gating chain. If the column name drifts
        //      back to `phone`, prefs.contactInfo.phone goes undefined
        //      and email "from" headers lose the business phone — silent
        //      UX regression we want to catch in CI.
        if (!dbAvailable) return;

        const tenantId = await createTenant(root, "PgConfigPrefs", "automotive");
        tenantsToClean.push(tenantId);
        await root.query(
            "UPDATE tenants SET owner_phone = $2, email_enabled = FALSE WHERE tenant_id = $1",
            [tenantId, "+15559998888"]
        );

        service.clearCache();
        const prefs = await service.getNotificationPreferences(tenantId);

        expect(prefs.smsEnabled).toBe(true);
        expect(prefs.emailEnabled).toBe(false);
        expect(prefs.reminderHours).toEqual([72, 24, 2]);
        expect(prefs.contactInfo?.phone).toBe("+15559998888");
        // contactInfo.email intentionally omitted from the interface — no
        // tenant-level email column exists. This assertion pins the shape.
        expect((prefs.contactInfo as { email?: string }).email).toBeUndefined();
    });

    it("HAPPY: getBusinessName returns the `name` column (no separate business_name today)", async () => {
        // WHO: every email-template render (subject, footer, from-header).
        // WHAT: getBusinessName returns the tenant's `name` directly.
        //       The fallback string "Business" is used only when no
        //       tenant row matches.
        // WHEN: every email-send for a known tenant.
        // WHERE: getBusinessName → getTenantConfig → row.name.
        // WHY: pre-fix the service tried to prefer `business_name` (which
        //      doesn't exist) and only fell back to `name`. Today there
        //      is exactly one source of truth for the business's display
        //      name; this test pins it. If a future migration adds a
        //      separate `business_name`, this test must be revisited.
        if (!dbAvailable) return;

        const tenantId = await createTenant(root, "Acme Tire & Auto", "automotive");
        tenantsToClean.push(tenantId);

        service.clearCache();
        const businessName = await service.getBusinessName(tenantId);

        expect(businessName).toBe("Acme Tire & Auto");
    });

    it("HAPPY: updateTenantConfig writes name/phone/timezone and the row matches", async () => {
        // WHO: a future tenant-settings PATCH endpoint, or ops running
        //      a manual update via this service.
        // WHAT: only the three fields the schema actually accepts
        //       (name, phone→owner_phone, timezone) write through.
        //       RETURNING surfaces the updated row in the expected shape.
        // WHEN: any owner-driven config change.
        // WHERE: updateTenantConfig UPDATE statement.
        // WHY: pins the column mapping in the WRITE path. The pre-fix
        //      version named `business_name`, `owner_email`, and `phone`
        //      directly — every one would have thrown
        //      `column "..." does not exist` against real Postgres.
        if (!dbAvailable) return;

        const tenantId = await createTenant(root, "PgConfigUpdate", "automotive");
        tenantsToClean.push(tenantId);

        service.clearCache();
        const updated = await service.updateTenantConfig(tenantId, {
            name: "Renamed Auto",
            phone: "+15554443333",
            timezone: "America/New_York",
        });

        expect(updated).not.toBeNull();
        expect(updated!.name).toBe("Renamed Auto");
        expect(updated!.phone).toBe("+15554443333");
        expect(updated!.timezone).toBe("America/New_York");

        // Verify the row landed correctly in the DB itself, not just in
        // RETURNING (which would mask a non-persisting bug).
        const row = await root.query<{ name: string; owner_phone: string; timezone: string }>(
            "SELECT name, owner_phone, timezone FROM tenants WHERE tenant_id = $1",
            [tenantId]
        );
        expect(row.rows[0].name).toBe("Renamed Auto");
        expect(row.rows[0].owner_phone).toBe("+15554443333");
        expect(row.rows[0].timezone).toBe("America/New_York");
    });

    it("SAD: getTenantConfig returns null for a non-existent tenant id", async () => {
        // WHO: any path that's handed a stale or fabricated tenant id —
        //      e.g. a deleted tenant's lingering session, an agent tool
        //      called with a tampered Authorization token.
        // WHAT: getTenantConfig returns null cleanly; no throw.
        // WHEN: any cache-miss for a tenant that doesn't exist.
        // WHERE: the `if (result.rows.length === 0) return null;` branch.
        // WHY: pins the contract that downstream callers expect — they
        //      branch on `config == null`, not a try/catch. A regression
        //      that raises instead of returning null cascades into the
        //      EmailService throw site as "Tenant configuration not found"
        //      vs as an unhandled DB error.
        if (!dbAvailable) return;

        const fakeId = "00000000-0000-0000-0000-deadbeef0000";
        service.clearCache();
        const config = await service.getTenantConfig(fakeId);

        expect(config).toBeNull();
    });

    describe("cache behavior", () => {
        it("HAPPY: a second lookup within TTL hits the cache, not the DB", async () => {
            // WHO: reminder worker + email/SMS hot paths that may dispatch
            //      multiple sends to the same tenant within the 60s window.
            // WHAT: after a cold lookup, a follow-up call for the same
            //       tenant returns the same TenantConfig object reference
            //       and issues ZERO new SELECTs against the DB.
            // WHEN: the moment the service became async-only and the
            //       cache became load-bearing (2026-05-13). Pre-change,
            //       the sync cache method was a fallback only; now it IS
            //       the hot path.
            // WHERE: getTenantConfig's `if (this.isCacheValid(key))` branch.
            // WHY: protects the DB from N+1 thundering on reminder bursts.
            //      If a refactor accidentally drops the cache check, this
            //      test surfaces a 2nd row in pg_stat — directly observable.
            if (!dbAvailable) return;

            const tenantId = await createTenant(root, "PgConfigCacheHot", "automotive");
            tenantsToClean.push(tenantId);

            service.clearCache();
            const first = await service.getTenantConfig(tenantId);
            expect(first).not.toBeNull();

            // Mutate the row directly in the DB. If the cache is working,
            // a follow-up lookup within TTL should still return the
            // ORIGINAL cached value, not the new DB value.
            await root.query(
                "UPDATE tenants SET name = $2 WHERE tenant_id = $1",
                [tenantId, "Mutated-Out-Of-Band"]
            );

            const second = await service.getTenantConfig(tenantId);
            expect(second!.name).toBe("PgConfigCacheHot"); // stale = cached
            expect(second).toBe(first); // same object reference
        });

        it("HAPPY: clearCache forces a fresh DB read", async () => {
            // WHO: tests + any future admin tool that wants to invalidate
            //      the cache after an external mutation.
            // WHAT: after clearCache(), the next lookup re-queries the DB
            //       and surfaces post-mutation state.
            // WHEN: any operational scenario where someone mutates the
            //       `tenants` row outside this service.
            // WHERE: the clearCache() method's two `.clear()` calls.
            // WHY: pins the escape hatch from the stale-cache trap. If a
            //      refactor moves cache state into a non-clearable
            //      structure, the second lookup here returns stale data
            //      and this test goes red.
            if (!dbAvailable) return;

            const tenantId = await createTenant(root, "PgConfigCacheClear", "automotive");
            tenantsToClean.push(tenantId);

            service.clearCache();
            await service.getTenantConfig(tenantId); // warm cache

            await root.query(
                "UPDATE tenants SET name = $2 WHERE tenant_id = $1",
                [tenantId, "Renamed-After-Cache"]
            );

            service.clearCache();
            const after = await service.getTenantConfig(tenantId);
            expect(after!.name).toBe("Renamed-After-Cache");
        });

        it("HAPPY: updateTenantConfig refreshes the cache with the new row", async () => {
            // WHO: any in-service writer (eventual Settings UI, ops tools).
            // WHAT: after an updateTenantConfig call, the cache holds the
            //       updated row — subsequent getTenantConfig returns the
            //       new value WITHOUT having to clearCache or wait for TTL.
            // WHEN: every write-then-read sequence inside the same process.
            // WHERE: the `this.cache.set(key, config)` line at the bottom
            //        of updateTenantConfig.
            // WHY: pins write-through cache semantics. A regression that
            //      forgets to update the cache after the UPDATE would let
            //      stale data linger for up to 60s (the TTL), causing
            //      "the change didn't take effect" reports from real users.
            if (!dbAvailable) return;

            const tenantId = await createTenant(root, "PgConfigCacheWrite", "automotive");
            tenantsToClean.push(tenantId);

            service.clearCache();
            await service.getTenantConfig(tenantId); // warm with original

            await service.updateTenantConfig(tenantId, { name: "Updated-Via-Service" });

            // Mutate the DB out-of-band to a value the cache won't see.
            // If the cache was correctly refreshed by updateTenantConfig,
            // getTenantConfig returns "Updated-Via-Service", not the
            // out-of-band value.
            await root.query(
                "UPDATE tenants SET name = $2 WHERE tenant_id = $1",
                [tenantId, "Sneaky-DB-Edit"]
            );

            const cached = await service.getTenantConfig(tenantId);
            expect(cached!.name).toBe("Updated-Via-Service");
        });

        it("HAPPY: expired cache entry forces a fresh DB read", async () => {
            // WHO: the 60-seconds-later code path — long-running worker
            //      processes that span past the TTL boundary.
            // WHAT: after the cache entry's expiry timestamp passes, the
            //       next getTenantConfig issues a fresh SELECT and picks
            //       up DB-side mutations.
            // WHEN: any tenant accessed at <1 min cadence indefinitely.
            // WHERE: the `isCacheValid` boolean — `expiry > Date.now()`.
            // WHY: pins the TTL-expiry path that's otherwise hard to
            //      exercise. We poke the private cacheExpiry map directly
            //      to simulate time-passing without sleeping 60 real
            //      seconds. A regression that forgets to gate the cache
            //      read on the TTL would let stale data live forever.
            if (!dbAvailable) return;

            const tenantId = await createTenant(root, "PgConfigCacheTTL", "automotive");
            tenantsToClean.push(tenantId);

            service.clearCache();
            await service.getTenantConfig(tenantId); // warm cache

            // Reach into private state — this is a test-only smell that
            // beats `setTimeout(60_000)` by 60×.
            const expiryMap = (service as unknown as { cacheExpiry: Map<string, number> }).cacheExpiry;
            expiryMap.set(tenantId, Date.now() - 1); // already expired

            await root.query(
                "UPDATE tenants SET name = $2 WHERE tenant_id = $1",
                [tenantId, "Post-Expiry"]
            );

            const refreshed = await service.getTenantConfig(tenantId);
            expect(refreshed!.name).toBe("Post-Expiry");
        });
    });
});
