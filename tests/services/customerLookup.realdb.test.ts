/**
 * Real-DB tests for getOrCreateCustomerByPhone — specifically, that a placeholder
 * name can always be corrected.
 *
 * THE BUG (a real call, 2026-07-12): the agent called book_with_scheduling with the
 * caller's phone but no name (she hadn't given it yet), so the customer was created
 * as 'Caller'. The booking then failed — but the row survives. She gave her name a
 * minute later, corrected the agent twice, and the CRM STILL says "Caller" today.
 *
 * The write-guard knew 'Caller' was junk (it wouldn't write it over a real name), but
 * the UPDATE's WHERE clause only overwrote NULL / '' / 'Valued Customer'. 'Caller'
 * wasn't in that list, so the real name matched zero rows and bounced off. The
 * placeholder was permanent.
 *
 * It gets worse with the preference prefetch: her record now loads on turn one of
 * every future call, so the agent would greet her as "Caller" — confidently, forever.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Client, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { getOrCreateCustomerByPhone } from '../../src/services/customerLookup';

let setup: Client;
let pool: Pool;
let dbAvailable = false;
let tenantId: string;
const tenantsToClean: string[] = [];
const PHONE = '+12624979039'; // hers

async function upsert(name: string) {
  const withTenantClient = createWithTenantClient(pool);
  return getOrCreateCustomerByPhone(withTenantClient, tenantId, PHONE, name);
}

async function storedName(): Promise<string> {
  const r = await setup.query<{ name: string }>(
    `SELECT name FROM customers WHERE tenant_id = $1 AND phone = $2`,
    [tenantId, PHONE]
  );
  return r.rows[0]?.name ?? '(no row)';
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (pool) await pool.end();
  if (setup) {
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach(async (ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  if (!dbAvailable) return;
  tenantId = await createTenant(setup, `Lookup ${Date.now()}`, 'auto-shop');
  tenantsToClean.push(tenantId);
});

describe('getOrCreateCustomerByPhone — placeholder names must be correctable', () => {
  it("THE BUG: a customer stored as 'Caller' can now be given their real name", async () => {
    // EXACTLY the 2026-07-12 sequence:
    //   1. agent books with a phone but no name  → customer created as 'Caller'
    //   2. booking fails (schedule cliff)        → the row survives anyway
    //   3. she gives her name                    → must overwrite the placeholder
    await upsert('Caller');
    expect(await storedName()).toBe('Caller');

    await upsert('Camille Mary DeMott');

    // Before the fix this stayed 'Caller' FOREVER — the UPDATE's WHERE clause never
    // listed 'Caller' as a placeholder, so it matched zero rows.
    expect(await storedName()).toBe('Camille Mary DeMott');
  });

  it("'Valued Customer' is also correctable (the placeholder that WAS handled)", async () => {
    await upsert('Valued Customer');
    await upsert('Reba Jones');
    expect(await storedName()).toBe('Reba Jones');
  });

  it('SAD: a placeholder must NEVER overwrite a real name', async () => {
    // The other direction. A later booking with no name must not wipe out the name
    // she already gave — that would be worse than never capturing it.
    await upsert('Camille Mary DeMott');
    await upsert('Caller'); // e.g. a second booking attempt before she re-states it
    expect(await storedName()).toBe('Camille Mary DeMott');
  });

  it('SAD: an empty/whitespace name never overwrites a real one', async () => {
    await upsert('Camille Mary DeMott');
    await upsert('   ');
    expect(await storedName()).toBe('Camille Mary DeMott');
  });

  it('HAPPY: a real name is written on first contact', async () => {
    await upsert('Reba Jones');
    expect(await storedName()).toBe('Reba Jones');
  });
});
