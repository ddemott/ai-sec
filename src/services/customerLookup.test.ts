/**
 * Tests for getOrCreateCustomerByPhone — the helper that owns the
 * "customer-create as a separate transaction from booking" guarantee.
 *
 * The helper's contract is narrow: given a tenant-scoped withTenantClient,
 * SELECT for an existing live customer by (tenant_id, phone), INSERT and
 * return the new id when no match exists, ignoring soft-deleted rows.
 * Callers above (agentTools book-appointment / book-with-scheduling) rely
 * on this so a downstream booking failure doesn't roll back the new caller.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';

import { getOrCreateCustomerByPhone } from './customerLookup';

const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const PHONE = '+15551234567';

interface MockQuery {
  text: string;
  params: unknown[];
}

function buildWithTenantClient(responses: Array<{ rows: unknown[] }>): {
  withTenantClient: <T>(t: string, fn: (c: PoolClient) => Promise<T>) => Promise<T>;
  queries: MockQuery[];
  observedTenantIds: string[];
} {
  const queries: MockQuery[] = [];
  const observedTenantIds: string[] = [];
  const queue = [...responses];

  const mockClient = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params: params || [] });
      return queue.shift() || { rows: [] };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;

  const withTenantClient = async <T>(
    tenantId: string,
    fn: (c: PoolClient) => Promise<T>
  ): Promise<T> => {
    observedTenantIds.push(tenantId);
    return fn(mockClient);
  };

  return { withTenantClient, queries, observedTenantIds };
}

describe('getOrCreateCustomerByPhone', () => {
  it('HAPPY: existing live customer returns its id without INSERT', async () => {
    // WHO: Returning caller — same tenant + phone hits an existing row
    // WHAT: Helper must short-circuit at the SELECT and skip INSERT
    // WHERE: src/services/customerLookup.ts
    // WHEN: Voice agent receives a call from a known number
    // WHY: Inserting again would create a duplicate-customer row and
    //       fail any future UNIQUE(tenant_id, phone) constraint
    const { withTenantClient, queries } = buildWithTenantClient([
      { rows: [{ customer_id: 'existing-id' }] },
    ]);

    const id = await getOrCreateCustomerByPhone(withTenantClient, TENANT_ID, PHONE, 'Bob');

    expect(id).toBe('existing-id');
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain('SELECT customer_id FROM customers');
    expect(queries[0].params).toEqual([TENANT_ID, PHONE]);
  });

  it('HAPPY: no match → INSERTs and returns the new id', async () => {
    // WHO: First-time caller — phone has never been seen for this tenant
    // WHAT: SELECT returns empty → INSERT with provided name → return id
    // WHERE: src/services/customerLookup.ts
    // WHY: Without this branch the booking RPC would have to know how to
    //       create customers, which is exactly the coupling we're undoing
    const { withTenantClient, queries } = buildWithTenantClient([
      { rows: [] },
      { rows: [{ customer_id: 'new-id' }] },
    ]);

    const id = await getOrCreateCustomerByPhone(withTenantClient, TENANT_ID, PHONE, 'Alice');

    expect(id).toBe('new-id');
    expect(queries).toHaveLength(2);
    expect(queries[0].text).toContain('SELECT customer_id FROM customers');
    expect(queries[1].text).toContain('INSERT INTO customers');
    expect(queries[1].params).toEqual([TENANT_ID, PHONE, 'Alice']);
  });

  it('SAD: soft-deleted row does not block a fresh INSERT', async () => {
    // WHO: Phone that was deleted in the past; same number calls again today
    // WHAT: SELECT predicate filters is_deleted=true → empty result →
    //       INSERT fires for the live row
    // WHERE: src/services/customerLookup.ts SELECT predicate
    // WHY: Resurrecting a soft-deleted customer would carry stale name/email
    //       data; treating deleted as missing keeps the new contact clean
    const { withTenantClient, queries } = buildWithTenantClient([
      { rows: [] }, // soft-deleted match excluded by the WHERE clause
      { rows: [{ customer_id: 'fresh-id' }] },
    ]);

    const id = await getOrCreateCustomerByPhone(withTenantClient, TENANT_ID, PHONE, 'Caller');

    expect(id).toBe('fresh-id');
    // Belt-and-suspenders: pin the predicate text so a future refactor
    // that drops the soft-delete filter fails this test loudly.
    expect(queries[0].text).toMatch(/is_deleted IS NULL OR is_deleted = false/);
  });

  it('WIRING: tenant_id is forwarded to withTenantClient for RLS scope', async () => {
    // WHO: Multi-tenant prod — wrong tenant context = cross-tenant leak
    // WHAT: The helper acquires its client via withTenantClient(tenant_id)
    //        so RLS sees the right value of app.current_tenant_id
    // WHERE: src/services/customerLookup.ts
    // WHY: A bug here would silently route writes against another tenant's
    //       schema, which is exactly what the multi-tenant probe (2026-05-06)
    //       was added to catch
    const { withTenantClient, observedTenantIds } = buildWithTenantClient([
      { rows: [{ customer_id: 'x' }] },
    ]);
    await getOrCreateCustomerByPhone(withTenantClient, TENANT_ID, PHONE, 'X');
    expect(observedTenantIds).toEqual([TENANT_ID]);
  });
});
