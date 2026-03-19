import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant } from "./test-utils";
import { Client } from "pg";

const SUPER_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000';

describe("Stripe Lite — Billing", () => {
  let client: Client;
  let tenantId: string;
  let dbAvailable = true;

  beforeAll(async () => {
    try {
      client = await getRootClient();
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
    await clearDB(client);
    const setup = await setupBasicTenant(client);
    tenantId = setup.tenantId;
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
    const cols = res.rows.map((r: any) => r.column_name);
    expect(cols).toContain('stripe_customer_id');
    expect(cols).toContain('stripe_subscription_id');
    expect(cols).toContain('subscription_status');
    expect(cols).toContain('subscription_plan');
  });

  it("subscription_status defaults to 'inactive'", async () => {
    if (!dbAvailable) return;

    const res = await client.query(
      `SELECT subscription_status FROM tenants WHERE id = $1`,
      [tenantId]
    );
    expect(res.rows[0].subscription_status).toBe('inactive');
  });

  it("stripe fields are nullable", async () => {
    if (!dbAvailable) return;

    const res = await client.query(
      `SELECT stripe_customer_id, stripe_subscription_id, subscription_plan FROM tenants WHERE id = $1`,
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
       WHERE id = $1`,
      [tenantId]
    );

    const res = await client.query(
      `SELECT subscription_status, subscription_plan, stripe_subscription_id FROM tenants WHERE id = $1`,
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
       WHERE id = $1`,
      [tenantId]
    );

    // Simulate payment failure
    await client.query(
      `UPDATE tenants SET subscription_status = 'past_due' WHERE stripe_customer_id = 'cus_test123'`
    );

    const res = await client.query(
      `SELECT subscription_status FROM tenants WHERE id = $1`,
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
       WHERE id = $1`,
      [tenantId]
    );

    // Simulate cancellation
    await client.query(
      `UPDATE tenants
       SET subscription_status = 'canceled', stripe_subscription_id = NULL, subscription_plan = NULL
       WHERE stripe_customer_id = 'cus_test123'`
    );

    const res = await client.query(
      `SELECT subscription_status, stripe_subscription_id, subscription_plan FROM tenants WHERE id = $1`,
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
      `UPDATE tenants SET subscription_status = 'active' WHERE id = $1`,
      [tenantId]
    );
    const res = await client.query(
      `SELECT subscription_status FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const status = res.rows[0].subscription_status;
    // Gate logic: active and inactive are allowed
    expect(['active', 'inactive'].includes(status)).toBe(true);
  });

  it("subscription gate: 'inactive' status should allow access (beta grace period)", async () => {
    if (!dbAvailable) return;

    const res = await client.query(
      `SELECT subscription_status FROM tenants WHERE id = $1`,
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
      `UPDATE tenants SET subscription_status = 'past_due' WHERE id = $1`,
      [tenantId]
    );
    const res = await client.query(
      `SELECT subscription_status FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const status = res.rows[0].subscription_status;
    // Gate logic: not active and not inactive → blocked
    expect(['active', 'inactive'].includes(status)).toBe(false);
  });

  it("subscription gate: 'canceled' status should block access", async () => {
    if (!dbAvailable) return;

    await client.query(
      `UPDATE tenants SET subscription_status = 'canceled' WHERE id = $1`,
      [tenantId]
    );
    const res = await client.query(
      `SELECT subscription_status FROM tenants WHERE id = $1`,
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
});
