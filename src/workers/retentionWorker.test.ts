/**
 * WHO:   the data-retention worker (automated PII erasure of dormant customers).
 * WHAT:  env-gating (must be explicitly enabled WITH a valid window), the
 *        eligibility query shape, the per-customer anonymize, and the
 *        one-tenant-failure-doesn't-halt-the-sweep behavior.
 * WHEN:  a scheduled retention pass.
 * WHERE: src/workers/retentionWorker.ts + src/services/retention/retentionService.ts.
 * WHY:   this erases PII irreversibly, so the gating tests are the most
 *        important in the suite — a worker that runs without an explicit window,
 *        or on the wrong default, would silently destroy customer data. These
 *        pin "off unless explicitly + validly enabled".
 */
import { describe, it, expect, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { resolveRetentionConfig, runRetentionPass } from './retentionWorker';
import {
  findEligibleCustomerIds,
  sweepTenant,
  anonymizeCustomerInTx,
} from '../services/retention/retentionService';

interface MockQuery {
  text: string;
  params: unknown[];
}

function mockClient(responses: Array<{ rows: unknown[] }>) {
  const queries: MockQuery[] = [];
  const queue = [...responses];
  const client = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params: params || [] });
      return queue.shift() ?? { rows: [] };
    }),
  } as unknown as PoolClient;
  return { client, queries };
}

describe('resolveRetentionConfig — gating (safety-critical)', () => {
  it('OFF by default: returns null when ENABLE_RETENTION_WORKER is unset', () => {
    expect(resolveRetentionConfig({})).toBeNull();
    expect(resolveRetentionConfig({ RETENTION_DAYS: '365' })).toBeNull();
  });

  it('OFF when the enable flag is anything other than the exact string "true"', () => {
    expect(
      resolveRetentionConfig({ ENABLE_RETENTION_WORKER: '1', RETENTION_DAYS: '365' })
    ).toBeNull();
    expect(
      resolveRetentionConfig({ ENABLE_RETENTION_WORKER: 'TRUE', RETENTION_DAYS: '365' })
    ).toBeNull();
  });

  it('OFF when enabled but RETENTION_DAYS is missing / non-numeric / non-positive', () => {
    // WHY: no default window — a missing/invalid value must mean "do nothing",
    //      never "erase with some fallback".
    expect(resolveRetentionConfig({ ENABLE_RETENTION_WORKER: 'true' })).toBeNull();
    expect(
      resolveRetentionConfig({ ENABLE_RETENTION_WORKER: 'true', RETENTION_DAYS: 'abc' })
    ).toBeNull();
    expect(
      resolveRetentionConfig({ ENABLE_RETENTION_WORKER: 'true', RETENTION_DAYS: '0' })
    ).toBeNull();
    expect(
      resolveRetentionConfig({ ENABLE_RETENTION_WORKER: 'true', RETENTION_DAYS: '-30' })
    ).toBeNull();
    expect(
      resolveRetentionConfig({ ENABLE_RETENTION_WORKER: 'true', RETENTION_DAYS: '30.5' })
    ).toBeNull();
  });

  it('ON only when explicitly enabled WITH a valid positive-integer window', () => {
    const cfg = resolveRetentionConfig({ ENABLE_RETENTION_WORKER: 'true', RETENTION_DAYS: '365' });
    expect(cfg).not.toBeNull();
    expect(cfg!.retentionDays).toBe(365);
    expect(cfg!.intervalMs).toBeGreaterThan(0); // default applied
    expect(cfg!.batchSize).toBe(100); // default applied
  });

  it('applies optional interval + batch overrides when valid', () => {
    const cfg = resolveRetentionConfig({
      ENABLE_RETENTION_WORKER: 'true',
      RETENTION_DAYS: '90',
      RETENTION_INTERVAL_MS: '3600000',
      RETENTION_BATCH_SIZE: '25',
    });
    expect(cfg!.intervalMs).toBe(3_600_000);
    expect(cfg!.batchSize).toBe(25);
  });
});

describe('findEligibleCustomerIds — query shape', () => {
  it('filters on not-deleted, the retention window, and no recent appointment', async () => {
    const { client, queries } = mockClient([
      { rows: [{ customer_id: 'c1' }, { customer_id: 'c2' }] },
    ]);

    const ids = await findEligibleCustomerIds(client, 'tenant-1', 365, 100);

    expect(ids).toEqual(['c1', 'c2']);
    const q = queries[0];
    expect(q.text).toContain('is_deleted = false');
    expect(q.text).toContain("created_at < now() - ($2 * interval '1 day')");
    expect(q.text).toContain('NOT EXISTS');
    expect(q.text).toContain('a.start_time >='); // recent-appointment guard
    expect(q.params).toEqual(['tenant-1', 365, 100]);
  });
});

describe('anonymizeCustomerInTx — erasure shape', () => {
  it('nulls PII, tombstones the phone, and redacts the audit_log snapshots', async () => {
    const { client, queries } = mockClient([{ rows: [] }, { rows: [] }]);

    await anonymizeCustomerInTx(client, 'tenant-1', 'c1', 'retention-worker');

    const upd = queries.find((x) => x.text.includes('UPDATE customers'));
    expect(upd!.text).toContain('name = NULL');
    expect(upd!.text).toContain("phone = 'PURGED-' || customer_id::text");
    expect(upd!.text).toContain('is_deleted = true');
    expect(upd!.params).toEqual(['c1', 'tenant-1', 'retention-worker']);

    const redact = queries.find((x) => x.text.includes('UPDATE audit_log'));
    expect(redact!.text).toContain('old_data = NULL');
    expect(redact!.params).toEqual(['tenant-1', 'c1']);
  });
});

describe('sweepTenant', () => {
  it('anonymizes every eligible customer found', async () => {
    // FIFO: eligibility SELECT → then 2 UPDATE pairs (customers + audit) per id.
    const { client, queries } = mockClient([
      { rows: [{ customer_id: 'c1' }, { customer_id: 'c2' }] }, // eligibility
      { rows: [] },
      { rows: [] }, // c1 anonymize + redact
      { rows: [] },
      { rows: [] }, // c2 anonymize + redact
    ]);
    const withTenantClient = async <T>(_t: string, fn: (c: PoolClient) => Promise<T>) => fn(client);

    const result = await sweepTenant(withTenantClient, 'tenant-1', 365, 100);

    expect(result.anonymizedCustomerIds).toEqual(['c1', 'c2']);
    const customerUpdates = queries.filter((x) => x.text.includes('UPDATE customers'));
    expect(customerUpdates).toHaveLength(2);
  });
});

describe('runRetentionPass', () => {
  it('iterates every tenant and one tenant failure does not halt the rest', async () => {
    const tenantIds = ['t-ok-1', 't-boom', 't-ok-2'];
    const pool = {
      query: vi.fn(async () => ({ rows: tenantIds.map((tenant_id) => ({ tenant_id })) })),
    } as unknown as Pool;

    // Inject withTenantClient (DI) so we control per-tenant behavior without
    // module mocking: 't-boom' throws on its eligibility query; the others each
    // surface one eligible customer to anonymize.
    const withTenantClient = async <T>(
      tenantId: string,
      fn: (c: PoolClient) => Promise<T>
    ): Promise<T> => {
      const client = {
        query: vi.fn(async (text: string) => {
          if (text.includes('SELECT c.customer_id')) {
            if (tenantId === 't-boom') throw new Error('boom');
            return { rows: [{ customer_id: 'x' }] };
          }
          return { rows: [] }; // the anonymize UPDATEs
        }),
      } as unknown as PoolClient;
      return fn(client);
    };

    const total = await runRetentionPass(
      pool,
      { retentionDays: 365, intervalMs: 1, batchSize: 100 },
      withTenantClient
    );

    // t-ok-1 + t-ok-2 each anonymize 1; t-boom errors but is swallowed.
    expect(total).toBe(2);
  });
});
