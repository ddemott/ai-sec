/**
 * Tests for getCrmSyncStatus — the shared sync-status reader used by
 * /jobber/sync/status, /hubspot/sync/status, /square/sync/status, and
 * /servicetitan/sync/status.
 *
 * Strategy: mock PoolClient.query, verify SQL params (provider arg
 * threads through correctly), and exercise the count-folding logic
 * against a representative set of entity_sync_map rows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';
import { getCrmSyncStatus } from './crmSyncStatus';

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

interface MockQuery {
  text: string;
  params: unknown[];
}

function buildClient(responses: Array<{ rows: unknown[] }>): {
  client: PoolClient;
  queries: MockQuery[];
} {
  const queries: MockQuery[] = [];
  const remaining = [...responses];
  const client = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params: params ?? [] });
      return remaining.shift() ?? { rows: [] };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
  return { client, queries };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getCrmSyncStatus — happy paths', () => {
  it('1. folds entity_sync_map counts into pending/error totals split by entity', async () => {
    // WHO: dashboard polling /jobber/sync/status to render the
    //      "X pending, Y errors" badge in the integrations panel.
    // WHAT: a representative row set covers every combination — the
    //      helper should sum each axis (sync_status and entity_type)
    //      independently, not double-count.
    // WHERE: getCrmSyncStatus, called by all four CRM provider routes.
    // WHY: a regression in the fold (e.g., AND instead of OR on
    //      pending+error) would understate badge counts and hide real
    //      sync problems from the operator.
    const { client, queries } = buildClient([
      { rows: [{ last_sync_at: '2026-04-30T12:00:00Z' }] },
      {
        rows: [
          { entity_type: 'customer', sync_status: 'synced', count: 100 },
          { entity_type: 'customer', sync_status: 'pending', count: 3 },
          { entity_type: 'customer', sync_status: 'error', count: 1 },
          { entity_type: 'appointment', sync_status: 'synced', count: 50 },
          { entity_type: 'appointment', sync_status: 'pending', count: 2 },
          { entity_type: 'appointment', sync_status: 'error', count: 4 },
        ],
      },
    ]);

    const result = await getCrmSyncStatus(client, TENANT_ID, 'square');

    expect(result).toEqual({
      last_sync_at: '2026-04-30T12:00:00Z',
      pending_count: 5,
      error_count: 5,
      total_mapped: { customers: 104, appointments: 56 },
    });
    expect(queries[0].params).toEqual([TENANT_ID, 'square']);
    expect(queries[1].params).toEqual([TENANT_ID, 'square']);
  });

  it('2. threads provider name into both queries (square)', async () => {
    // WHO: HubSpot route handler.
    // WHAT: the provider arg must be the second parameter on BOTH the
    //       settings SELECT and the entity_sync_map SELECT — a typo in
    //       either would cross-pollute provider data.
    // WHY: tenant_integration_settings and entity_sync_map both have
    //      multi-provider rows for the same tenant; filtering only
    //      one of the two by provider would mix counts.
    const { queries, client } = buildClient([{ rows: [{ last_sync_at: null }] }, { rows: [] }]);

    await getCrmSyncStatus(client, TENANT_ID, 'square');

    expect(queries[0].text).toContain('FROM tenant_integration_settings');
    expect(queries[0].params[1]).toBe('square');
    expect(queries[1].text).toContain('FROM entity_sync_map');
    expect(queries[1].params[1]).toBe('square');
  });

  it('3. returns null last_sync_at when no settings row exists', async () => {
    // WHO: tenant who connected the CRM but hasn't synced yet, or
    //      whose row got cleared in a partial reset.
    // WHAT: helper must return last_sync_at: null (not undefined,
    //       not the empty string) so the dashboard's null-check logic
    //       renders "Never" instead of "Invalid Date".
    // WHY: the dashboard formats this with new Date(...) and prints
    //      "Never synced yet" only when the value is strictly null.
    const { client } = buildClient([{ rows: [] }, { rows: [] }]);

    const result = await getCrmSyncStatus(client, TENANT_ID, 'square');

    expect(result.last_sync_at).toBeNull();
    expect(result.pending_count).toBe(0);
    expect(result.error_count).toBe(0);
    expect(result.total_mapped).toEqual({ customers: 0, appointments: 0 });
  });

  it('4. ignores entity types other than customer/appointment in totals', async () => {
    // WHO: forward-compatibility — a future migration could introduce
    //      entity_type='employee' or similar.
    // WHAT: total_mapped only buckets customer + appointment; any
    //      other entity_type rows must NOT inflate either total but
    //      should still be counted in pending/error if applicable.
    // WHY: The dashboard contract is documented as customers +
    //      appointments only; sneaking other types into those buckets
    //      would silently mislead the operator.
    const { client } = buildClient([
      { rows: [{ last_sync_at: '2026-04-30T00:00:00Z' }] },
      {
        rows: [
          { entity_type: 'customer', sync_status: 'synced', count: 5 },
          { entity_type: 'employee', sync_status: 'synced', count: 99 },
          { entity_type: 'employee', sync_status: 'pending', count: 1 },
        ],
      },
    ]);

    const result = await getCrmSyncStatus(client, TENANT_ID, 'square');

    expect(result.total_mapped).toEqual({ customers: 5, appointments: 0 });
    // pending_count is axis-independent of entity_type — the employee
    // pending row still counts toward the total.
    expect(result.pending_count).toBe(1);
  });
});

describe('getCrmSyncStatus — sad paths', () => {
  it('5. propagates DB errors instead of swallowing them', async () => {
    // WHO: caller hitting an unexpected DB failure (connection drop,
    //      permission error, RLS context not set).
    // WHAT: the helper must let the error bubble up so the route's
    //       withHandler returns the standard 500 — silent fallback
    //       (e.g., returning zeros) would mask real problems.
    // WHY: a sync-status badge that says "0 pending" because the
    //      query failed is worse than no badge — operators would
    //      assume health.
    const failingClient = {
      query: vi.fn().mockRejectedValue(new Error('connection terminated')),
      release: vi.fn(),
    } as unknown as PoolClient;

    await expect(getCrmSyncStatus(failingClient, TENANT_ID, 'square')).rejects.toThrow(
      /connection terminated/
    );
  });
});
