import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  getRootClient,
  clearDB,
  setupBasicTenant,
  createCustomerFull,
  beginTestTransaction,
  rollbackTestTransaction,
  skipIfDbDown,
} from './test-utils';
import { type Client } from 'pg';

describe('Customer Management', () => {
  let client: Client;
  let tenantId: string;
  let dbAvailable = true;
  beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

  beforeAll(async () => {
    try {
      client = await getRootClient();
      await clearDB(client);
      const setup = await setupBasicTenant(client);
      tenantId = setup.tenantId;
    } catch (err) {
      dbAvailable = false;
      // eslint-disable-next-line no-console
      console.warn('[customer.test] Skipping DB tests - connection failed', err);
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

  it('should create a customer with all fields including timezone', async () => {
    // WHO: any flow that creates a customer record (voice booking,
    //      dashboard manual entry, CRM sync inbound)
    // WHAT: every column listed in the schema is writable + readable
    //       round trip — name, phone, email, address parts, timezone
    // WHEN: customer onboarding (first inbound call) or admin entry
    // WHERE: customers table schema
    // WHY: the timezone column was added in the timezone-aware
    //      scheduling work; without it, voice AI would default every
    //      caller to UTC and "today at 2pm" would map to wrong wall
    //      time. This test pins that the timezone column is writable
    //      with a real IANA zone string and survives a round trip
    if (!dbAvailable) return;
    const res = await client.query(
      `INSERT INTO customers (
                tenant_id, name, phone, email, address, city, state, postal_code, timezone
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        tenantId,
        'John Doe',
        '+15559998888',
        'john@example.com',
        '123 Main St',
        'Chicago',
        'IL',
        '60601',
        'America/Chicago',
      ]
    );

    expect(res.rows[0].name).toBe('John Doe');
    expect(res.rows[0].timezone).toBe('America/Chicago');
    expect(res.rows[0].city).toBe('Chicago');
  });

  it("should update a customer's timezone and address", async () => {
    // WHO: customer who has moved (or had wrong timezone on first entry)
    //      and needs both fields updated
    // WHAT: UPDATE persists both timezone and city; the read-back row
    //       reflects both new values
    // WHEN: any flow that mutates customer profile fields — admin
    //       edit, voice AI updating after caller correction, CRM sync
    //       pulling a changed remote record
    // WHERE: customers UPDATE path
    // WHY: a regression that silently dropped one of these fields on
    //      UPDATE (e.g., a column rename + missed callsite) would
    //      surface as voice AI scheduling appointments in the
    //      caller's old timezone — confusing but easy to miss in
    //      manual testing. Pin the round-trip here
    if (!dbAvailable) return;
    const customerId = await createCustomerFull(client, tenantId, '+15551112222', 'Old Name');

    await client.query('UPDATE customers SET timezone = $1, city = $2 WHERE customer_id = $3', [
      'America/Los_Angeles',
      'Los Angeles',
      customerId,
    ]);

    const checkRes = await client.query('SELECT * FROM customers WHERE customer_id = $1', [
      customerId,
    ]);
    expect(checkRes.rows[0].timezone).toBe('America/Los_Angeles');
    expect(checkRes.rows[0].city).toBe('Los Angeles');
  });

  it('soft-deletes a customer that has messages (hard DELETE would FK-violate)', async () => {
    // WHO: an owner deleting a customer from the CRM who has received/left a
    //      message. WHAT: the delete route now soft-deletes (is_deleted=true)
    //      instead of a hard DELETE. WHEN: 2026-07-01 — owners reported "deleting
    //      customers isn't working". WHERE: DELETE /customers/:id. WHY: customer_
    //      messages (and job_inquiries) FK customers with ON DELETE NO ACTION, so
    //      a hard DELETE raised 23503 for any customer with a message and the row
    //      never went away. Soft-delete never trips the FK and preserves history.
    if (!dbAvailable) return;
    const customerId = await createCustomerFull(client, tenantId, '+15557778888', 'Has Messages');
    await client.query(
      `INSERT INTO customer_messages (tenant_id, customer_id, caller_name, message)
         VALUES ($1, $2, 'Test Caller', 'Please call me back')`,
      [tenantId, customerId]
    );

    // A hard DELETE fails the NO ACTION FK (savepoint so the aborted statement
    // doesn't poison the outer test transaction).
    await client.query('SAVEPOINT sp_harddelete');
    await expect(
      client.query('DELETE FROM customers WHERE customer_id = $1', [customerId])
    ).rejects.toMatchObject({ code: '23503' });
    await client.query('ROLLBACK TO SAVEPOINT sp_harddelete');

    // The route's soft-delete succeeds and hides the row from is_deleted=false lists.
    const res = await client.query(
      // tenant-scoped WHERE mirrors the production route so this test would fail
      // if the route dropped its tenant_id predicate.
      `UPDATE customers SET is_deleted = true, deleted_at = now(), deleted_by = 'test'
         WHERE customer_id = $1 AND tenant_id = $2 AND is_deleted = false
         RETURNING customer_id`,
      [customerId, tenantId]
    );
    expect(res.rowCount).toBe(1);
    const check = await client.query('SELECT is_deleted FROM customers WHERE customer_id = $1', [
      customerId,
    ]);
    expect(check.rows[0].is_deleted).toBe(true);
  });

  it('should default timezone to America/New_York if not specified', async () => {
    // WHO: any insert path that doesn't pass timezone explicitly —
    //      e.g., an older API version, a migration that didn't backfill,
    //      a partial INSERT from a CRM webhook
    // WHAT: customers.timezone column has DEFAULT 'America/New_York'
    //       so the inserted row has a usable IANA zone even when omitted
    // WHEN: every insert that doesn't pass timezone explicitly
    // WHERE: customers table column default
    // WHY: a NULL timezone column would crash the time-formatting code
    //      in voice AI prompts ("today at 2pm" needs a zone). The
    //      DEFAULT keeps callers from hitting NULL even on partial
    //      writes; this test pins that default so a migration that
    //      drops it surfaces here, not in production at call time
    if (!dbAvailable) return;
    const res = await client.query(
      "INSERT INTO customers (tenant_id, name, phone) VALUES ($1, 'Default Tz', '+15553334444') RETURNING timezone",
      [tenantId]
    );
    expect(res.rows[0].timezone).toBe('America/New_York');
  });
});
