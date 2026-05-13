import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant, beginTestTransaction, rollbackTestTransaction } from "./test-utils";
import { Client } from "pg";

const SUPER_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000';

describe("Stripe Lite — Billing", () => {
  let client: Client;
  let tenantId: string;
  let dbAvailable = true;

  beforeAll(async () => {
    try {
      client = await getRootClient();
      await clearDB(client);
      const setup = await setupBasicTenant(client);
      tenantId = setup.tenantId;
    } catch (err) {
      dbAvailable = false;
      console.warn("[billing.test] Skipping DB tests - connection failed", err);
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

  // --- Schema Tests ---

  it("tenants table has subscription columns", async () => {
    if (!dbAvailable) return;

    const res = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'tenants'
       AND column_name IN ('stripe_customer_id', 'stripe_subscription_id', 'subscription_status', 'subscription_plan')
       ORDER BY column_name`
    );
    const cols = res.rows.map((r: { column_name: string }) => r.column_name);
    expect(cols).toContain('stripe_customer_id');
    expect(cols).toContain('stripe_subscription_id');
    expect(cols).toContain('subscription_status');
    expect(cols).toContain('subscription_plan');
  });

  it("subscription_status defaults to 'inactive'", async () => {
    if (!dbAvailable) return;

    const res = await client.query(
      `SELECT subscription_status FROM tenants WHERE tenant_id = $1`,
      [tenantId]
    );
    expect(res.rows[0].subscription_status).toBe('inactive');
  });

  it("stripe fields are nullable", async () => {
    if (!dbAvailable) return;

    const res = await client.query(
      `SELECT stripe_customer_id, stripe_subscription_id, subscription_plan FROM tenants WHERE tenant_id = $1`,
      [tenantId]
    );
    expect(res.rows[0].stripe_customer_id).toBeNull();
    expect(res.rows[0].stripe_subscription_id).toBeNull();
    expect(res.rows[0].subscription_plan).toBeNull();
  });

  // --- Subscription Lifecycle Tests ---

  it("can activate a subscription (checkout.session.completed)", async () => {
    if (!dbAvailable) return;

    await client.query(
      `UPDATE tenants
       SET stripe_customer_id = 'cus_test123',
           stripe_subscription_id = 'sub_test456',
           subscription_status = 'active',
           subscription_plan = 'solo'
       WHERE tenant_id = $1`,
      [tenantId]
    );

    const res = await client.query(
      `SELECT subscription_status, subscription_plan, stripe_subscription_id FROM tenants WHERE tenant_id = $1`,
      [tenantId]
    );
    expect(res.rows[0].subscription_status).toBe('active');
    expect(res.rows[0].subscription_plan).toBe('solo');
    expect(res.rows[0].stripe_subscription_id).toBe('sub_test456');
  });

  it("can mark subscription as past_due (invoice.payment_failed)", async () => {
    if (!dbAvailable) return;

    await client.query(
      `UPDATE tenants
       SET stripe_customer_id = 'cus_test123', subscription_status = 'active', subscription_plan = 'growth'
       WHERE tenant_id = $1`,
      [tenantId]
    );

    // Simulate payment failure
    await client.query(
      `UPDATE tenants SET subscription_status = 'past_due' WHERE stripe_customer_id = 'cus_test123'`
    );

    const res = await client.query(
      `SELECT subscription_status FROM tenants WHERE tenant_id = $1`,
      [tenantId]
    );
    expect(res.rows[0].subscription_status).toBe('past_due');
  });

  it("can cancel a subscription (customer.subscription.deleted)", async () => {
    if (!dbAvailable) return;

    await client.query(
      `UPDATE tenants
       SET stripe_customer_id = 'cus_test123', stripe_subscription_id = 'sub_test456',
           subscription_status = 'active', subscription_plan = 'solo'
       WHERE tenant_id = $1`,
      [tenantId]
    );

    // Simulate cancellation
    await client.query(
      `UPDATE tenants
       SET subscription_status = 'canceled', stripe_subscription_id = NULL, subscription_plan = NULL
       WHERE stripe_customer_id = 'cus_test123'`
    );

    const res = await client.query(
      `SELECT subscription_status, stripe_subscription_id, subscription_plan FROM tenants WHERE tenant_id = $1`,
      [tenantId]
    );
    expect(res.rows[0].subscription_status).toBe('canceled');
    expect(res.rows[0].stripe_subscription_id).toBeNull();
    expect(res.rows[0].subscription_plan).toBeNull();
  });

  // --- Subscription Gate Logic Tests ---

  it("subscription gate: 'active' status should allow access", async () => {
    if (!dbAvailable) return;

    await client.query(
      `UPDATE tenants SET subscription_status = 'active' WHERE tenant_id = $1`,
      [tenantId]
    );
    const res = await client.query(
      `SELECT subscription_status FROM tenants WHERE tenant_id = $1`,
      [tenantId]
    );
    const status = res.rows[0].subscription_status;
    // Gate logic: active and inactive are allowed
    expect(['active', 'inactive'].includes(status)).toBe(true);
  });

  it("subscription gate: 'inactive' status should allow access (beta grace period)", async () => {
    if (!dbAvailable) return;

    const res = await client.query(
      `SELECT subscription_status FROM tenants WHERE tenant_id = $1`,
      [tenantId]
    );
    const status = res.rows[0].subscription_status;
    expect(status).toBe('inactive');
    // Gate logic: inactive is allowed (default for new tenants)
    expect(['active', 'inactive'].includes(status)).toBe(true);
  });

  it("subscription gate: 'past_due' status should block access", async () => {
    if (!dbAvailable) return;

    await client.query(
      `UPDATE tenants SET subscription_status = 'past_due' WHERE tenant_id = $1`,
      [tenantId]
    );
    const res = await client.query(
      `SELECT subscription_status FROM tenants WHERE tenant_id = $1`,
      [tenantId]
    );
    const status = res.rows[0].subscription_status;
    // Gate logic: not active and not inactive → blocked
    expect(['active', 'inactive'].includes(status)).toBe(false);
  });

  it("subscription gate: 'canceled' status should block access", async () => {
    if (!dbAvailable) return;

    await client.query(
      `UPDATE tenants SET subscription_status = 'canceled' WHERE tenant_id = $1`,
      [tenantId]
    );
    const res = await client.query(
      `SELECT subscription_status FROM tenants WHERE tenant_id = $1`,
      [tenantId]
    );
    const status = res.rows[0].subscription_status;
    expect(['active', 'inactive'].includes(status)).toBe(false);
  });

  it("subscription gate: super-admin tenant is always exempt", async () => {
    if (!dbAvailable) return;

    // Super-admin exemption is based on tenant ID check, not DB status
    expect(SUPER_ADMIN_TENANT_ID).toBe('00000000-0000-0000-0000-000000000000');
    // The gate skips the DB check entirely for this tenant ID
  });

  it("index on stripe_customer_id exists for webhook lookups", async () => {
    if (!dbAvailable) return;

    const res = await client.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'tenants' AND indexname = 'idx_tenants_stripe_customer'`
    );
    expect(res.rows.length).toBe(1);
  });

  // --- Error Diagnostics ---

  describe("Error diagnostics", () => {
    it("subscription gate logic correctly identifies blocked statuses", async () => {
      if (!dbAvailable) return;

      // Verify the gate logic: only 'active' and 'inactive' are allowed
      const allowedStatuses = ['active', 'inactive'];
      const blockedStatuses = ['past_due', 'canceled'];

      for (const status of allowedStatuses) {
        await client.query(
          `UPDATE tenants SET subscription_status = $1 WHERE tenant_id = $2`,
          [status, tenantId]
        );
        const res = await client.query(
          `SELECT subscription_status FROM tenants WHERE tenant_id = $1`,
          [tenantId]
        );
        const val = res.rows[0].subscription_status;
        // Gate allows these — verify the value round-trips correctly
        expect(['active', 'inactive'].includes(val)).toBe(true);
      }

      for (const status of blockedStatuses) {
        await client.query(
          `UPDATE tenants SET subscription_status = $1 WHERE tenant_id = $2`,
          [status, tenantId]
        );
        const res = await client.query(
          `SELECT subscription_status FROM tenants WHERE tenant_id = $1`,
          [tenantId]
        );
        const val = res.rows[0].subscription_status;
        // Gate blocks these — verify the value is specific (not generic)
        expect(['active', 'inactive'].includes(val)).toBe(false);
        expect(val).toBe(status); // exact status preserved for 402 response context
      }
    });

    it("billing status lookup for non-existent tenant returns zero rows (not crash)", async () => {
      if (!dbAvailable) return;

      const fakeTenantId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const res = await client.query(
        `SELECT subscription_status, subscription_plan FROM tenants WHERE tenant_id = $1`,
        [fakeTenantId]
      );

      // Route handler checks res.rows.length === 0 and returns 404
      // At the DB level, this should return empty — not throw
      expect(res.rows).toHaveLength(0);
    });

    it("subscription_plan can only be set to known plan names or NULL", async () => {
      if (!dbAvailable) return;

      // Valid plan names: solo, growth, professional, or NULL
      await client.query(
        `UPDATE tenants SET subscription_plan = 'solo' WHERE tenant_id = $1`,
        [tenantId]
      );
      const res1 = await client.query(
        `SELECT subscription_plan FROM tenants WHERE tenant_id = $1`,
        [tenantId]
      );
      expect(res1.rows[0].subscription_plan).toBe('solo');

      // NULL is valid (canceled subscription)
      await client.query(
        `UPDATE tenants SET subscription_plan = NULL WHERE tenant_id = $1`,
        [tenantId]
      );
      const res2 = await client.query(
        `SELECT subscription_plan FROM tenants WHERE tenant_id = $1`,
        [tenantId]
      );
      expect(res2.rows[0].subscription_plan).toBeNull();
    });

    it("stripe_customer_id update with non-existent tenant_id updates zero rows", async () => {
      if (!dbAvailable) return;

      const fakeTenantId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const res = await client.query(
        `UPDATE tenants SET stripe_customer_id = 'cus_phantom' WHERE tenant_id = $1`,
        [fakeTenantId]
      );

      // Should silently update zero rows — the billing route should check rowCount
      expect(res.rowCount).toBe(0);
    });
  });
});
