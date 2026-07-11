/**
 * WHO:   POST /customers/import — bulk CSV customer onboarding
 * WHAT:  owner uploads a CSV (as JSON { csv }); rows are validated,
 *        phone-normalized, deduped (in-file + against existing customers)
 *        and inserted in one transaction
 * WHEN:  onboarding a new tenant with an existing customer list
 * WHERE: src/routes/customers.ts + src/services/csv.ts + shared/phone.ts
 * WHY:   this is a bulk PII write: it must be owner-gated, size-limited,
 *        reject malformed CSV with a clear 400 (never a 500), and report
 *        exactly what was imported/skipped so the owner trusts the result.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildRouteTestApp, type RouteTestAppHandle } from '../mock';

// The customer routes fire fire-and-forget CRM syncs on create/update/delete;
// stub the orchestrator so no real sync code runs (import itself dispatches
// no syncs — asserted below).
vi.mock('../../src/services/syncOrchestrator', () => ({
  syncCustomerToAll: vi.fn(),
  syncAppointmentToAll: vi.fn(),
}));

import { registerCustomerRoutes } from '../../src/routes/customers';
import { syncCustomerToAll } from '../../src/services/syncOrchestrator';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

let handle: RouteTestAppHandle;
let app: FastifyInstance;

function importReq(csv: string) {
  return app.inject({
    method: 'POST',
    url: '/customers/import',
    payload: { tenant_id: TENANT_ID, csv },
  });
}

/** Data queries only (transaction + RLS scaffolding filtered out). */
function dataQueries() {
  return handle.queries.filter(
    (q) =>
      !q.text.startsWith('SET LOCAL') &&
      !q.text.startsWith('RESET') &&
      q.text !== 'BEGIN' &&
      q.text !== 'COMMIT' &&
      q.text !== 'ROLLBACK'
  );
}

beforeAll(async () => {
  handle = buildRouteTestApp((a, pool, withTenantClient) => {
    registerCustomerRoutes(a, pool, withTenantClient);
  });
  app = handle.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  handle.queries.length = 0;
  handle.queryResponses.length = 0;
  handle.tenantIdOverride.current = null;
  handle.auth.current = {
    user_id: '00000000-0000-0000-0000-000000000001',
    tenant_id: TENANT_ID,
    email: 'owner@test.local',
    role: 'owner',
  };
  vi.clearAllMocks();
});

describe('POST /customers/import', () => {
  it('HAPPY: valid rows are normalized and inserted; response reports counts', async () => {
    // WHAT: two clean rows — phone normalized to E.164, notes folded into
    //       metadata, name split into first/last.
    // Scripted: the existing-phones SELECT returns no rows.
    handle.queryResponses.push({ rows: [] });

    const csv =
      'name,phone,email,notes\n' +
      'Jane Smith,630-555-0001,jane@example.com,VIP\n' +
      'Bob Jones,(630) 555-0002,,\n';
    const res = await importReq(csv);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      success: true,
      imported: 2,
      skipped_duplicates: 0,
      total_rows: 2,
      errors: [],
    });

    const inserts = dataQueries().filter((q) => q.text.includes('INSERT INTO customers'));
    expect(inserts.length).toBe(1);
    // Row 1: tenant, name, first, last, normalized phone, email, metadata.
    expect(inserts[0].params.slice(0, 7)).toEqual([
      TENANT_ID,
      'Jane Smith',
      'Jane',
      'Smith',
      '+16305550001',
      'jane@example.com',
      { notes: 'VIP' },
    ]);
    // Row 2: no email/notes → nulls + empty metadata.
    expect(inserts[0].params.slice(7, 14)).toEqual([
      TENANT_ID,
      'Bob Jones',
      'Bob',
      'Jones',
      '+16305550002',
      null,
      {},
    ]);
    // WHY: bulk import deliberately dispatches NO per-row CRM syncs (would
    //      saturate the pool at 2000 rows).
    expect(syncCustomerToAll).not.toHaveBeenCalled();
  });

  it('HAPPY: liberal header matching — case/spacing variants and first/last name columns', async () => {
    // WHO: an owner exporting from Excel/another CRM ("First Name", "Phone Number").
    handle.queryResponses.push({ rows: [] });

    const csv = ' First Name , LAST NAME ,Phone Number\nAda,Lovelace,6305550003\n';
    const res = await importReq(csv);

    expect(res.statusCode).toBe(200);
    expect(res.json().imported).toBe(1);
    const insert = dataQueries().find((q) => q.text.includes('INSERT INTO customers'));
    expect(insert!.params.slice(1, 5)).toEqual(['Ada Lovelace', 'Ada', 'Lovelace', '+16305550003']);
  });

  it('HAPPY: quoted fields with embedded commas/newlines survive into the insert', async () => {
    handle.queryResponses.push({ rows: [] });

    const csv = 'name,phone,notes\n"Smith, Jane",6305550004,"line1\nline2, still notes"\n';
    const res = await importReq(csv);

    expect(res.statusCode).toBe(200);
    expect(res.json().imported).toBe(1);
    const insert = dataQueries().find((q) => q.text.includes('INSERT INTO customers'));
    expect(insert!.params[1]).toBe('Smith, Jane');
    expect(insert!.params[6]).toEqual({ notes: 'line1\nline2, still notes' });
  });

  it('SAD: rows with an invalid/missing phone are skipped and reported; valid rows still import', async () => {
    // WHO: a hand-built list with a truncated number.
    // WHY: normalizePhone rejects <10 digits — importing "555" would create
    //      an uncallable customer the voice agent can never match.
    handle.queryResponses.push({ rows: [] });

    const csv = 'name,phone\nGood Gal,6305550005\nBad Bob,555\nNo Phone,\n';
    const res = await importReq(csv);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imported).toBe(1);
    // Row numbers count the header as row 1 (matches Excel).
    expect(body.errors).toEqual([
      { row: 3, reason: 'invalid phone "555"' },
      { row: 4, reason: 'missing phone' },
    ]);
  });

  it('SAD: rows with an invalid email are skipped and reported', async () => {
    handle.queryResponses.push({ rows: [] });

    const csv = 'name,phone,email\nEve Err,6305550006,not-an-email\n';
    const res = await importReq(csv);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imported).toBe(0);
    expect(body.errors).toEqual([{ row: 2, reason: 'invalid email "not-an-email"' }]);
  });

  it('SAD: in-file duplicates (same normalized phone, different formatting) are skipped once', async () => {
    // WHAT: 630-555-0007 and +1 (630) 555-0007 are the SAME number after
    //       normalizePhone — only the first row imports.
    handle.queryResponses.push({ rows: [] });

    const csv = 'name,phone\nFirst In,630-555-0007\nSecond Copy,+1 (630) 555-0007\n';
    const res = await importReq(csv);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imported).toBe(1);
    expect(body.skipped_duplicates).toBe(1);
    expect(body.errors).toEqual([]);
  });

  it('SAD: rows matching an EXISTING tenant customer by normalized phone are skipped as duplicates', async () => {
    // WHO: an owner re-importing last year's list on top of live data.
    // Scripted: the existing-phones SELECT returns a stored (raw-format) phone.
    handle.queryResponses.push({ rows: [{ phone: '(630) 555-0008' }] });

    const csv = 'name,phone\nAlready Here,+16305550008\nActually New,6305550009\n';
    const res = await importReq(csv);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imported).toBe(1);
    expect(body.skipped_duplicates).toBe(1);
    // The existing-phones lookup was tenant-scoped and excluded soft-deleted.
    const select = dataQueries().find((q) => q.text.includes('SELECT phone FROM customers'));
    expect(select!.params[0]).toBe(TENANT_ID);
    expect(select!.text).toContain('is_deleted = false');
  });

  it('SAD: a CSV over the 1 MB limit is rejected 400 before parsing', async () => {
    // WHY: a hard cap keeps a fat-fingered upload (or abuse) from pinning the
    //      event loop in the parser. (Fastify's own 1 MiB body limit backstops
    //      anything larger with a 413.)
    const csv = 'name,phone\n' + 'a'.repeat(1_000_100);
    const res = await importReq(csv);

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('CSV too large');
    expect(dataQueries().length).toBe(0);
  });

  it('SAD: more than 2000 data rows is rejected 400 with the count', async () => {
    const rows = Array.from(
      { length: 2001 },
      (_, i) => `P${i},630555${String(i).padStart(4, '0')}`
    );
    const csv = 'name,phone\n' + rows.join('\n') + '\n';
    const res = await importReq(csv);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('2000');
    expect(dataQueries().length).toBe(0);
  });

  it('SAD: malformed CSV (unclosed quote) is a clear 400, not a 500', async () => {
    const res = await importReq('name,phone\n"Broken Row,6305550010\n');

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Malformed CSV');
    expect(body.error).toContain('Unclosed quoted field');
  });

  it('SAD: a CSV without a recognizable phone column is rejected 400', async () => {
    const res = await importReq('name,favorite_color\nAnn,blue\n');

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('phone column');
  });

  it('SAD: a CSV without any name column is rejected 400', async () => {
    const res = await importReq('phone,email\n6305550011,a@b.com\n');

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('name column');
  });

  it('SAD: a header-only CSV is rejected 400', async () => {
    const res = await importReq('name,phone\n');

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('at least one data row');
  });

  it('SAD: a missing/empty csv field fails zod validation with details', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/customers/import',
      payload: { tenant_id: TENANT_ID },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Validation failed');
    expect(body.details).toBeDefined();
  });

  it('SECURITY: a front-desk user is rejected 403 before any query runs', async () => {
    handle.auth.current = {
      user_id: '00000000-0000-0000-0000-000000000002',
      tenant_id: TENANT_ID,
      email: 'frontdesk@test.local',
      role: 'front_desk',
    };

    const res = await importReq('name,phone\nAnn,6305550012\n');

    expect(res.statusCode).toBe(403);
    expect(res.json().success).toBe(false);
    expect(dataQueries().length).toBe(0);
  });

  it('SECURITY: an unauthenticated request is rejected 401', async () => {
    handle.auth.current = null;

    const res = await importReq('name,phone\nAnn,6305550013\n');

    expect(res.statusCode).toBe(401);
  });
});
