/**
 * Route-level tests for the destructive tenant routes:
 *   DELETE /tenants/:id        — admin removes a tenant entirely
 *   POST /tenants/reorder      — admin saves a new sort_order across tenants
 *
 * These are the two routes whose failure modes can lose customer data
 * (delete) or scramble the admin tenant picker (reorder), so the test
 * file pins both happy paths and the validation/auth/rollback contracts.
 *
 * The DB-level reorder schema is covered separately in
 * `src/tenant-reorder.test.ts` (real Postgres, schema + ORDER BY contract).
 * This file covers the route handler surface — auth gates, payload
 * validation, the BEGIN/COMMIT shape, and the response envelope.
 *
 * Origin: historical major refactor (see RESOLVED.md) "Add tests for destructive flows" —
 * the verify-first found that DELETE /tenants/:id and POST /tenants/reorder
 * had no route-handler-level coverage despite the dashboard side
 * exercising them via superadmin.test.tsx.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerTenantRoutes } from './routes/tenants';
import {
  createMockClient,
  createMockPool,
  type MockClient,
  type MockResponse,
} from './test-utils-mock';

// Real v4 UUIDs — Zod schemas in the route handler reject pattern fillers.
const TENANT_ID_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TENANT_ID_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const TENANT_ID_C = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';

let app: FastifyInstance;
let mockClient: MockClient;
let queryResponses: MockResponse[];
let queries: { text: string; params: unknown[] }[];
let authStub: {
  user_id: string;
  tenant_id: string;
  email: string;
  role: 'owner' | 'front_desk';
} | null;

function buildApp() {
  const handle = createMockClient();
  mockClient = handle.mockClient;
  queryResponses = handle.queryResponses;
  queries = handle.queries;
  const mockPool = createMockPool(mockClient);

  const fastify = Fastify({ logger: false });

  // Stub the JWT auth that requireAuth() depends on. Tests set authStub
  // in beforeEach to control whether the route is "authenticated".
  fastify.addHook('preHandler', async (request) => {
    (request as unknown as { auth: typeof authStub }).auth = authStub;
  });

  // Stand-in for the production withTenantClient — bypasses the real
  // tenant-exists check + RLS set_config dance and just hands the mock
  // client to the callback. The mock client returns whatever
  // queryResponses we've pushed for this test.
  const withTenantClient = async <T>(
    _tenantId: string,
    fn: (client: typeof mockClient) => Promise<T>
  ): Promise<T> => fn(mockClient);

  registerTenantRoutes(
    fastify,
    mockPool,
    withTenantClient as unknown as Parameters<typeof registerTenantRoutes>[2]
  );
  return fastify;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  queries.length = 0;
  queryResponses.length = 0;
  // Default: authenticated as a super-admin user. JWT payload shape is
  // snake_case (tenant_id, user_id) — matches the verified JWT decoded
  // by registerJwtAuthHook.
  authStub = {
    user_id: 'admin-user',
    tenant_id: '00000000-0000-0000-0000-000000000000',
    email: 'admin@test',
    role: 'owner',
  };
});

// ════════════════════════════════════════════════════════════════════
// DELETE /tenants/:id
// ════════════════════════════════════════════════════════════════════

describe('DELETE /tenants/:id — happy paths', () => {
  it('HAPPY: deletes the tenant when the row exists and returns success', async () => {
    // WHO: super-admin removing a churned customer's tenant
    // WHAT: route runs `DELETE FROM tenants WHERE tenant_id = $1 RETURNING tenant_id`,
    //       sees rowCount=1 via assertRowAffected, returns { success: true }
    // WHEN: confirm-by-name dialog has resolved + admin confirmed delete
    // WHERE: src/routes/tenants.ts → app.delete('/tenants/:id', ...)
    // WHY: this is the destructive path — it must (a) actually run the DELETE
    //      against the live DB, (b) report success only when a row was affected
    //      (so a race-condition double-delete returns 404 not silent success),
    //      and (c) emit the audit log event so support can trace which user
    //      destroyed which tenant
    queryResponses.push({ rows: [{ tenant_id: TENANT_ID_A }], rowCount: 1 });

    const res = await app.inject({ method: 'DELETE', url: `/tenants/${TENANT_ID_A}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain('DELETE FROM tenants');
    expect(queries[0].params).toEqual([TENANT_ID_A]);
  });
});

describe('DELETE /tenants/:id — sad paths', () => {
  it('SAD: returns 404 when no row was affected (tenant id does not exist)', async () => {
    // WHO: caller passing an id for a tenant that no longer exists
    //      (typo, race with a concurrent delete, stale UI state)
    // WHAT: assertRowAffected sees rowCount=0 → 404 + error envelope
    // WHEN: a deleted tenant's id is reused in a delete request
    // WHERE: routeHelpers.assertRowAffected — silent-no-op guard
    // WHY: returning 200 on a no-op delete would let UIs incorrectly mark
    //      the tenant as deleted, hiding stale state from the user
    queryResponses.push({ rows: [], rowCount: 0 });

    const res = await app.inject({ method: 'DELETE', url: `/tenants/${TENANT_ID_A}` });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ success: false });
  });

  it('SAD: returns 401 when no auth context is attached', async () => {
    // WHO: unauthenticated request reaching the delete endpoint
    //      (token expired, never logged in, manually-crafted request)
    // WHAT: requireAuth fails fast → 401 before any DB query runs
    // WHEN: any unauthenticated DELETE attempt
    // WHERE: requireAuth(req, reply) at top of the handler
    // WHY: tenant deletion must never run without an authenticated principal —
    //      the audit log entry would otherwise have no actor to attribute
    authStub = null;

    const res = await app.inject({ method: 'DELETE', url: `/tenants/${TENANT_ID_A}` });

    expect(res.statusCode).toBe(401);
    expect(queries).toHaveLength(0); // no DB query — auth gate fired first
  });
});

// ════════════════════════════════════════════════════════════════════
// POST /tenants/reorder
// ════════════════════════════════════════════════════════════════════

describe('POST /tenants/reorder — happy paths', () => {
  it('HAPPY: assigns sort_order = 0..N-1 in transaction order', async () => {
    // WHO: super-admin saving a new tenant ordering after drag/drop
    // WHAT: route opens a transaction, runs one batched UPDATE via unnest($1::uuid[], $2::int[]),
    //       commits, and emits an audit event with the count
    // WHEN: admin clicks "Save Order" in the drag-reorder banner
    // WHERE: src/routes/tenants.ts → app.post('/tenants/reorder', ...)
    // WHY: the per-row UPDATE order matters — if the loop is reversed or
    //      indexes drift, the saved order doesn't match what the admin saw,
    //      and they'll lose confidence in the picker. Pinning the
    //      sort_order = i invariant prevents that drift
    queryResponses.push({ rows: [], rowCount: 0 }); // BEGIN
    queryResponses.push({ rows: [], rowCount: 3 }); // single batch UPDATE
    queryResponses.push({ rows: [], rowCount: 0 }); // COMMIT

    const res = await app.inject({
      method: 'POST',
      url: '/tenants/reorder',
      payload: { order: [TENANT_ID_C, TENANT_ID_A, TENANT_ID_B] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });

    const updateQueries = queries.filter((q) => q.text.startsWith('UPDATE'));
    expect(updateQueries).toHaveLength(1);
    expect(updateQueries[0].text).toContain('unnest(');
    expect(updateQueries[0].params).toEqual([
      [TENANT_ID_C, TENANT_ID_A, TENANT_ID_B],
      [0, 1, 2],
    ]);

    // BEGIN must precede the UPDATE and COMMIT must follow
    expect(queries[0].text).toBe('BEGIN');
    expect(queries[queries.length - 1].text).toBe('COMMIT');
  });
});

describe('POST /tenants/reorder — sad paths', () => {
  it('SAD: returns 400 when order is missing or empty', async () => {
    // WHO: malformed client request with empty `order` array
    // WHAT: handler validates `Array.isArray(order) && order.length > 0` → 400
    // WHEN: a buggy client posts {} or { order: [] }
    // WHERE: src/routes/tenants.ts:159 input validation block
    // WHY: an empty-array reorder is a no-op but the handler would still
    //      open + commit a transaction with zero updates, polluting the
    //      audit log with empty events; reject early
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/reorder',
      payload: { order: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ success: false });
    expect(queries).toHaveLength(0); // no DB query, no transaction
  });

  it('SAD: returns 400 when order is not an array', async () => {
    // WHO: client submitting wrong-shape payload (string, object, null)
    // WHAT: Array.isArray check fails → 400
    // WHY: defense in depth — a non-array body would crash the for-loop
    //      with a confusing runtime error instead of a clean validation 400
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/reorder',
      payload: { order: 'not-an-array' },
    });

    expect(res.statusCode).toBe(400);
    expect(queries).toHaveLength(0);
  });

  it('SAD: ROLLBACK on UPDATE failure mid-transaction (no partial reorder)', async () => {
    // WHO: a DB hiccup (lock timeout, FK violation) hits during the
    //      reorder transaction's 2nd UPDATE
    // WHAT: handler's try/catch ROLLBACKs and re-throws; route's withHandler
    //       wrapper turns the throw into a 500 envelope. No partial reorder
    //       persists.
    // WHEN: rare but real — a concurrent migration or write contention
    //       causes one of the UPDATEs to fail
    // WHERE: src/routes/tenants.ts BEGIN/UPDATE/COMMIT block, catch arm
    // WHY: a half-committed reorder would leave tenants in an inconsistent
    //      sort_order state — some rows updated, some not. ROLLBACK keeps
    //      the table consistent and lets the admin retry.
    queryResponses.push({ rows: [], rowCount: 0 }); // BEGIN
    queryResponses.push({ rows: [], rowCount: 1 }); // UPDATE row 0 succeeds
    // Force the next query (UPDATE row 1) to throw — overrides the FIFO queue
    // by replacing the mock once.
    const originalQuery = mockClient.query;
    let callIdx = 0;
    mockClient.query = vi.fn(async (text: string, params?: unknown[]) => {
      callIdx++;
      if (callIdx === 3) {
        // 3rd query is the 2nd UPDATE; throw to simulate DB error.
        throw new Error('lock_not_available');
      }
      return originalQuery(text, params);
    });

    const res = await app.inject({
      method: 'POST',
      url: '/tenants/reorder',
      payload: { order: [TENANT_ID_C, TENANT_ID_A, TENANT_ID_B] },
    });

    expect(res.statusCode).toBe(500);
    // restore so subsequent tests aren't affected
    mockClient.query = originalQuery;
  });

  it('SAD: returns 401 when no auth context is attached', async () => {
    // WHO: unauthenticated reorder attempt
    // WHAT: requireAuth fails fast → 401 before any DB query runs
    // WHY: tenant ordering is admin-scoped data — must not be writable
    //      by anonymous callers regardless of payload validity
    authStub = null;

    const res = await app.inject({
      method: 'POST',
      url: '/tenants/reorder',
      payload: { order: [TENANT_ID_A] },
    });

    expect(res.statusCode).toBe(401);
    expect(queries).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// POST /tenants/:id/update-config — wizard re-pick cleanup
// ════════════════════════════════════════════════════════════════════
//
// Pinned by the 2026-05-28 bug: Dale picked "Bakery" in the wizard but
// step 1 kept showing answering-service services because a prior pass
// had already auto-seeded them and the wizard's `services.length > 0`
// gate skipped re-seeding. Fix moves the cleanup into the route so any
// business_type change (any caller, any session) gets the same rollback.

describe('POST /tenants/:id/update-config — business_type change cleanup', () => {
  beforeEach(() => {
    // Caller is the tenant's owner — passes the requireAuth + same-tenant gate.
    authStub = {
      user_id: 'owner-user',
      tenant_id: TENANT_ID_A,
      email: 'owner@test',
      role: 'owner',
    };
  });

  it('HAPPY: a business_type change wipes auto-seeded services + resources in one tx', async () => {
    // WHO: owner re-picking a different business_type during onboarding
    //      (or via the Settings business-type changer)
    // WHAT: route opens a tx, SELECT ... FOR UPDATE pulls the prior
    //       business_type, UPDATE writes the new one, then DELETE wipes
    //       services + resources where is_auto_seeded = true. Single tx
    //       so a crash mid-flow doesn't leave the tenant with the new
    //       business_type and the OLD template's seeded rows.
    // WHEN: every business_type change for a tenant that has previously
    //       auto-seeded rows in the DB.
    // WHERE: src/routes/tenants.ts → POST /tenants/:id/update-config
    // WHY: pins the 2026-05-28 fix. A regression that drops the DELETE
    //      or skips the BEGIN/COMMIT would resurrect the stale-defaults
    //      bug Dale reported. Pinning the query ORDER (SELECT → UPDATE
    //      → DELETE services → DELETE resources → COMMIT) also catches
    //      a refactor that moves cleanup OUTSIDE the tx, where a
    //      partial-failure rollback would no longer undo it.
    queryResponses.push({ rows: [], rowCount: 0 }); // BEGIN
    queryResponses.push({ rows: [{ business_type: 'answering-service' }], rowCount: 1 }); // SELECT FOR UPDATE
    queryResponses.push({ rows: [{ tenant_id: TENANT_ID_A }], rowCount: 1 }); // UPDATE tenants
    queryResponses.push({ rows: [{ service_id: 's1' }, { service_id: 's2' }], rowCount: 2 }); // DELETE services
    queryResponses.push({ rows: [{ resource_id: 'r1' }], rowCount: 1 }); // DELETE resources
    queryResponses.push({ rows: [], rowCount: 0 }); // COMMIT

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${TENANT_ID_A}/update-config`,
      payload: { business_type: 'bakery' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    // Pin tx boundaries + correct cleanup order.
    expect(queries[0].text).toBe('BEGIN');
    expect(queries[1].text).toContain(
      'SELECT business_type, system_prompt, voice_id, first_message'
    );
    expect(queries[1].text).toContain('FROM tenants');
    expect(queries[1].text).toContain('FOR UPDATE');
    expect(queries[2].text).toContain('UPDATE tenants SET');
    expect(queries[3].text).toContain('DELETE FROM services');
    expect(queries[3].text).toContain('is_auto_seeded = true');
    expect(queries[4].text).toContain('DELETE FROM resources');
    expect(queries[4].text).toContain('is_auto_seeded = true');
    expect(queries[queries.length - 1].text).toBe('COMMIT');
  });

  it('HAPPY: same-business_type update does NOT delete anything', async () => {
    // WHO: caller PATCHing voice_id or system_prompt without changing
    //      business_type (Settings → Voice tab; a re-save with the
    //      same template selected).
    // WHAT: cleanup is gated on `body.business_type !== priorBusinessType`.
    //       When the value is unchanged (or omitted), the DELETEs are
    //       skipped entirely — only the UPDATE runs inside the tx.
    // WHEN: every config edit that touches voice/prompt without
    //       reselecting a template.
    // WHERE: src/routes/tenants.ts businessTypeChanged branch.
    // WHY: protects the owner's typed-in services from being wiped when
    //      they just want to change a voice setting. A regression that
    //      drops the equality guard would silently delete is_auto_seeded
    //      rows on every voice-only save — invisible to the caller,
    //      catastrophic to a tenant who hasn't typed over the seed yet.
    queryResponses.push({ rows: [], rowCount: 0 }); // BEGIN
    queryResponses.push({ rows: [{ business_type: 'bakery' }], rowCount: 1 }); // SELECT FOR UPDATE
    queryResponses.push({ rows: [{ tenant_id: TENANT_ID_A }], rowCount: 1 }); // UPDATE tenants
    queryResponses.push({ rows: [], rowCount: 0 }); // COMMIT

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${TENANT_ID_A}/update-config`,
      payload: { business_type: 'bakery', voice_id: 'clara' },
    });

    expect(res.statusCode).toBe(200);
    // No DELETE statements — only the BEGIN, SELECT, UPDATE, COMMIT.
    const deleteQueries = queries.filter((q) => q.text.startsWith('DELETE'));
    expect(deleteQueries).toHaveLength(0);
  });

  it('SAD: ROLLBACK when DELETE fails (no partial cleanup, no stale tenant row)', async () => {
    // WHO: a DB error (lock timeout, FK violation, RLS denial) hits
    //      during the DELETE FROM services after the UPDATE has run.
    // WHAT: the route's try/catch ROLLBACKs and re-throws → withHandler
    //       turns the throw into a 500. The earlier UPDATE is undone by
    //       the ROLLBACK, so the tenant is NOT left with the new
    //       business_type while the old auto-seeded rows still exist.
    // WHEN: any DB-side failure between the UPDATE and the COMMIT.
    // WHERE: src/routes/tenants.ts catch arm of the BEGIN/COMMIT block.
    // WHY: this is the exact reason the cleanup lives inside the same
    //      tx as the UPDATE. If a refactor accidentally splits them
    //      into two separate withPoolClient calls, a crash in the
    //      middle would resurrect the stale-defaults bug for that
    //      tenant AND make the UI inconsistent ("I picked bakery but I
    //      still see answering-service services").
    let callIdx = 0;
    const originalQuery = mockClient.query;
    mockClient.query = vi.fn(async (text: string, params?: unknown[]) => {
      callIdx++;
      if (text === 'BEGIN') return { rows: [], rowCount: 0 };
      if (callIdx === 2) return { rows: [{ business_type: 'answering-service' }], rowCount: 1 };
      if (callIdx === 3) return { rows: [{ tenant_id: TENANT_ID_A }], rowCount: 1 };
      if (callIdx === 4) throw new Error('lock_not_available'); // DELETE services
      return originalQuery(text, params);
    });

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${TENANT_ID_A}/update-config`,
      payload: { business_type: 'bakery' },
    });

    expect(res.statusCode).toBe(500);
    expect(queries.some((q) => q.text === 'ROLLBACK')).toBe(true);

    mockClient.query = originalQuery;
  });

  it('SAD: cross-tenant config update is rejected 403 BEFORE any tx opens', async () => {
    // WHO: caller authenticated as one tenant trying to mutate another
    //      tenant's config (a stale token, a hand-crafted request, or
    //      a malicious browser tab).
    // WHAT: the same-tenant guard at the top of the handler returns
    //       403 before withTenantClient is even called — no tx, no
    //       state mutation, nothing to clean up.
    // WHEN: every authenticated-but-wrong-tenant request to
    //       /tenants/:id/update-config.
    // WHERE: requireAuth + the explicit `req.auth.tenant_id !== id`
    //        check at the top of the route.
    // WHY: closes the cross-tenant write surface. Without this guard,
    //      a tenant-A user could mutate tenant-B's business_type AND
    //      trigger tenant-B's auto-seed cleanup — a self-serve
    //      denial-of-data attack. The 401-anon CVE fix from 2026-05-21
    //      handles unauthenticated; this pins the cross-tenant case.
    authStub = {
      user_id: 'other-tenant-user',
      tenant_id: TENANT_ID_B,
      email: 'other@test',
      role: 'owner',
    };

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${TENANT_ID_A}/update-config`,
      payload: { business_type: 'bakery' },
    });

    expect(res.statusCode).toBe(403);
    expect(queries).toHaveLength(0); // no DB calls — guard fired first
  });

  it('HAPPY: partial body preserves omitted fields (partial-update safety)', async () => {
    // WHO: AI config view sending only voice_id (a common single-field update)
    // WHAT: UPDATE params use prior DB values for any field absent from body
    // WHEN: body has voice_id but no system_prompt / business_type / first_message
    // WHERE: src/routes/tenants.ts → partial-update merge logic
    // WHY: before the fix, omitted fields were passed as undefined → null,
    //      silently zeroing out system_prompt + first_message on every
    //      partial save. Regression test pins the merge behaviour.
    queryResponses.push({ rows: [], rowCount: 0 }); // BEGIN
    queryResponses.push({
      rows: [
        {
          business_type: 'auto_shop',
          system_prompt: 'You are a helpful assistant.',
          voice_id: 'old-voice',
          first_message: 'Hello!',
        },
      ],
      rowCount: 1,
    }); // SELECT FOR UPDATE — prior values
    queryResponses.push({ rows: [{ tenant_id: TENANT_ID_A }], rowCount: 1 }); // UPDATE tenants
    queryResponses.push({ rows: [], rowCount: 0 }); // COMMIT

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${TENANT_ID_A}/update-config`,
      payload: { voice_id: 'ara' }, // only voice_id; everything else omitted
    });

    expect(res.statusCode).toBe(200);
    // The UPDATE query params: [system_prompt, voice_id, business_type, first_message, tenant_id]
    // Omitted fields must use prior values, not undefined/null.
    const updateQuery = queries.find((q) => q.text.includes('UPDATE tenants SET'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery!.params[0]).toBe('You are a helpful assistant.'); // system_prompt preserved
    expect(updateQuery!.params[1]).toBe('ara'); // voice_id from body
    expect(updateQuery!.params[2]).toBe('auto_shop'); // business_type preserved
    expect(updateQuery!.params[3]).toBe('Hello!'); // first_message preserved
  });

  it('HAPPY: customer-preference fields persist through update-config', async () => {
    // WHO: owner enabling preference capture + writing guidance in the AI
    //      config page, then saving.
    // WHAT: save_preferences_enabled + preferences_instructions are written to
    //      the UPDATE so the agent's tenant-config fetch sees them next call.
    // WHERE: src/routes/tenants.ts UPDATE tenants SET ... save_preferences_enabled, preferences_instructions.
    // WHY: without these in the UPDATE the dashboard toggle is cosmetic — it
    //      would look saved but never reach the DB or the voice agent.
    queryResponses.push({ rows: [], rowCount: 0 }); // BEGIN
    queryResponses.push({
      rows: [
        {
          business_type: 'salon',
          system_prompt: 'You are Bella.',
          voice_id: 'ara',
          first_message: 'Hi!',
          save_preferences_enabled: false,
          preferences_instructions: null,
        },
      ],
      rowCount: 1,
    }); // SELECT FOR UPDATE — prior values
    queryResponses.push({ rows: [{ tenant_id: TENANT_ID_A }], rowCount: 1 }); // UPDATE
    queryResponses.push({ rows: [], rowCount: 0 }); // COMMIT

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${TENANT_ID_A}/update-config`,
      payload: {
        save_preferences_enabled: true,
        preferences_instructions: 'Remember the stylist and last service.',
      },
    });

    expect(res.statusCode).toBe(200);
    const updateQuery = queries.find((q) => q.text.includes('UPDATE tenants SET'));
    expect(updateQuery!.text).toContain('save_preferences_enabled');
    expect(updateQuery!.text).toContain('preferences_instructions');
    // Param order: [system_prompt, voice_id, business_type, first_message,
    //               save_preferences_enabled, preferences_instructions, tenant_id]
    expect(updateQuery!.params[4]).toBe(true); // from body
    expect(updateQuery!.params[5]).toBe('Remember the stylist and last service.'); // from body
  });

  it('HAPPY: forward_phone persists through update-config', async () => {
    // WHO: owner setting the "forward calls to my cell" number on the AI config
    //      page, then saving.
    // WHAT: forward_phone is written to the UPDATE so the agent's tenant-config
    //      fetch sees it next call and transfer_call can SIP-REFER to it.
    // WHEN: body carries forward_phone.
    // WHERE: src/routes/tenants.ts UPDATE tenants SET ... forward_phone = $10.
    // WHY: without it in the UPDATE the dashboard field is cosmetic — it would
    //      look saved but never reach the DB or the voice agent's transfer path.
    queryResponses.push({ rows: [], rowCount: 0 }); // BEGIN
    queryResponses.push({
      rows: [
        {
          business_type: 'auto_shop',
          system_prompt: 'You are a helpful assistant.',
          voice_id: 'ara',
          first_message: 'Hello!',
          save_preferences_enabled: false,
          preferences_instructions: null,
          tts_voice: null,
          tts_speed: null,
          tts_soft: null,
          tts_cheerful: null,
          tts_formal: null,
          tts_warm: null,
          tts_concise: null,
          forward_phone: null,
        },
      ],
      rowCount: 1,
    }); // SELECT FOR UPDATE — prior values
    queryResponses.push({ rows: [{ tenant_id: TENANT_ID_A }], rowCount: 1 }); // UPDATE
    queryResponses.push({ rows: [], rowCount: 0 }); // COMMIT

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${TENANT_ID_A}/update-config`,
      payload: { forward_phone: '+16082175303' },
    });

    expect(res.statusCode).toBe(200);
    const updateQuery = queries.find((q) => q.text.includes('UPDATE tenants SET'));
    expect(updateQuery!.text).toContain('forward_phone');
    // Param order: [system_prompt, voice_id, business_type, first_message,
    //   save_preferences_enabled, preferences_instructions, tts_voice,
    //   tts_speed, tts_soft, tts_cheerful, tts_formal, tts_warm, tts_concise,
    //   forward_phone, tenant_id]
    expect(updateQuery!.params[13]).toBe('+16082175303'); // from body
  });

  it('HAPPY: omitting preference fields preserves their prior values', async () => {
    // WHY: a save from the Voice Settings page that only touches system_prompt
    //      must NOT silently disable an already-enabled preference toggle.
    queryResponses.push({ rows: [], rowCount: 0 }); // BEGIN
    queryResponses.push({
      rows: [
        {
          business_type: 'salon',
          system_prompt: 'old',
          voice_id: 'ara',
          first_message: 'Hi!',
          save_preferences_enabled: true,
          preferences_instructions: 'Keep notes on regulars.',
        },
      ],
      rowCount: 1,
    }); // SELECT FOR UPDATE
    queryResponses.push({ rows: [{ tenant_id: TENANT_ID_A }], rowCount: 1 }); // UPDATE
    queryResponses.push({ rows: [], rowCount: 0 }); // COMMIT

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${TENANT_ID_A}/update-config`,
      payload: { system_prompt: 'new prompt' }, // preference fields omitted
    });

    expect(res.statusCode).toBe(200);
    const updateQuery = queries.find((q) => q.text.includes('UPDATE tenants SET'));
    expect(updateQuery!.params[4]).toBe(true); // preserved
    expect(updateQuery!.params[5]).toBe('Keep notes on regulars.'); // preserved
  });
});
