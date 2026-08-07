/**
 * Real-DB companion tests for /agent-tools/find-customer-by-name
 * (per docs/TODO.md "Verification blind spots" — P0 verification).
 *
 * The dynamic ILIKE search at src/routes/agentTools.ts:921-934 — matching
 * the caller's spoken name against `name` OR the concatenated
 * `first_name || ' ' || last_name` fallback — never runs in the existing
 * mocked suite (src/agentTools.test.ts mocks pg), and the booking /
 * preferences real-DB suites don't touch it either. This file runs the
 * actual SQL against a real Postgres: ILIKE case-folding, NULLIF/COALESCE
 * display-name derivation, apostrophe quoting, is_deleted filtering,
 * ORDER BY updated_at DESC NULLS LAST, and the LIMIT 5 cap.
 *
 * Strategy mirrors agentToolsPreferences.test.ts: real pg.Pool on
 * API_DB_URL + createWithTenantClient + the actual route registered on a
 * throwaway Fastify app, auth via the x-agent-secret header. Skips
 * honestly when the test DB isn't up. Own tenant(s) only, cleaned up in
 * afterAll via DELETE FROM tenants (cascades to customers) — NEVER
 * TRUNCATE, other suites share this DB.
 *
 * 5W for sad-path failures:
 *   WHO  — the LiveKit voice agent identifying a caller by spoken name
 *          (forwarded line ⇒ caller ID is useless, name is all we have)
 *   WHAT — POST /agent-tools/find-customer-by-name {tenant_id, name}
 *   WHEN — first turns of an inbound call, before any booking
 *   WHERE — agentTools.ts find-customer-by-name → ILIKE over customers
 *   WHY  — a broken match means every returning caller is greeted as a
 *          stranger; an over-broad match reads a WRONG customer's phone
 *          number back to the caller (privacy leak)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { type Client, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerAgentToolRoutes } from '../../src/routes/agentTools';

const AGENT_SECRET = 'test-customer-search-secret';
const stubEmbedding = (): Promise<number[]> => Promise.resolve(new Array(1536).fill(0));
const stubNormalizer = async (text: string): Promise<string> => text;

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
let otherTenantId: string;
const tenantsToClean: string[] = [];

function post(path: string, payload: unknown, secret: string = AGENT_SECRET) {
  return app.inject({
    method: 'POST',
    url: path,
    headers: { 'x-agent-secret': secret },
    payload,
  });
}

function findByName(name: unknown, tenant: string = tenantId) {
  return post('/agent-tools/find-customer-by-name', { tenant_id: tenant, name });
}

/**
 * Insert a customer with full control over the name-related columns.
 * createCustomer() from test-utils only sets `name`; this suite needs
 * first_name/last_name, empty-string names, is_deleted and explicit
 * updated_at to exercise every branch of the route's SQL.
 */
async function insertCustomer(opts: {
  tenant?: string;
  phone: string;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  is_deleted?: boolean;
  updated_at?: string | null;
}): Promise<string> {
  const res = await setup.query<{ customer_id: string }>(
    `INSERT INTO customers (tenant_id, phone, name, first_name, last_name, is_deleted, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))
     RETURNING customer_id`,
    [
      opts.tenant ?? tenantId,
      opts.phone,
      opts.name ?? null,
      opts.first_name ?? null,
      opts.last_name ?? null,
      opts.is_deleted ?? false,
      opts.updated_at ?? null,
    ]
  );
  return res.rows[0].customer_id;
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });
    process.env.AGENT_SECRET = AGENT_SECRET;

    app = Fastify({ logger: false });
    const withTenantClient = createWithTenantClient(pool);
    registerAgentToolRoutes(app, pool, withTenantClient, stubEmbedding, stubNormalizer);
    await app.ready();

    tenantId = await createTenant(setup, 'Customer Search Salon', 'salon');
    tenantsToClean.push(tenantId);
    otherTenantId = await createTenant(setup, 'Customer Search Other Tenant', 'salon');
    tenantsToClean.push(otherTenantId);

    // ── Fixtures (all inside our own tenant; phones unique per tenant) ──
    // Plain `name` column — apostrophe bait for the ILIKE concatenation.
    await insertCustomer({ phone: '+15552000001', name: "Sarah O'Brien" });
    // Plain `name` column — partial/case-insensitive probes.
    await insertCustomer({ phone: '+15552000002', name: 'Michael Thornberry' });
    // name NULL, only first/last — exercises the concatenated fallback for
    // BOTH the WHERE match and the COALESCE display-name derivation.
    await insertCustomer({
      phone: '+15552000003',
      name: null,
      first_name: 'Priya',
      last_name: 'Patelsdottir',
    });
    // name is EMPTY STRING (imported rows do this) — NULLIF(name,'') must
    // kick the display name over to first/last, never return ''.
    await insertCustomer({
      phone: '+15552000004',
      name: '',
      first_name: 'Emptyfield',
      last_name: 'Nameless',
    });
    // Soft-deleted — must be invisible to the search.
    await insertCustomer({ phone: '+15552000005', name: 'Deleted Dorabella', is_deleted: true });
    // Fully nameless row (name NULL, first/last NULL) — must never match
    // a real search term and must never crash the COALESCE chain.
    await insertCustomer({ phone: '+15552000006', name: null });
    // Six shared-surname customers with staggered updated_at — proves the
    // LIMIT 5 cap and ORDER BY updated_at DESC (newest first, oldest
    // dropped). Zephyrina-1 is oldest … Zephyrina-6 is newest.
    for (let i = 1; i <= 6; i++) {
      await insertCustomer({
        phone: `+1555200010${i}`,
        name: `Zephyrina Overflowsen ${i}`,
        updated_at: `2026-01-0${i}T12:00:00Z`,
      });
    }
    // Same-named customer in ANOTHER tenant — must never leak across.
    await insertCustomer({
      tenant: otherTenantId,
      phone: '+15552000001',
      name: 'Isolde Crosstenant',
    });

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[agentToolsCustomerSearch.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
  delete process.env.AGENT_SECRET;
});

beforeEach(async (ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
});

describe('find-customer-by-name — ILIKE name search against real Postgres', () => {
  it('HAPPY: exact full-name match returns that customer with their MASKED phone', async () => {
    // WHO: a returning caller who states their full name.
    // WHAT: exact match on the `name` column via ILIKE '%<name>%'.
    // WHEN: caller identification at the top of a call.
    // WHERE: routes/agentTools/identity.ts find-customer-by-name (name branch).
    // WHY: the agent reads the phone back to confirm identity ("is this still
    //      your number?"), so the ROUTE masks it — `maskPhoneForConfirmation`
    //      emits `+1•••-•••-0002`. A name is a claim anyone can make; handing
    //      the full number to whoever guesses a name right would turn the
    //      confirm step into a disclosure. The fixtures below still INSERT real
    //      numbers — masking is a property of the read path, not the data, and
    //      these expectations must stay masked.
    const res = await findByName('Michael Thornberry');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      result: { matches: [{ name: 'Michael Thornberry', phone: '+1•••-•••-0002' }] },
    });
  });

  it('HAPPY: partial first-name matches (substring ILIKE)', async () => {
    // WHY: callers often give only a first name; '%mich%' must still hit.
    const res = await findByName('Michael');
    expect(res.statusCode).toBe(200);
    expect(res.json().result.matches).toEqual([
      { name: 'Michael Thornberry', phone: '+1•••-•••-0002' },
    ]);
  });

  it('HAPPY: partial last-name matches', async () => {
    // WHY: "this is Mrs. Thornberry" — surname-only lookup must work too.
    const res = await findByName('Thornberr');
    expect(res.statusCode).toBe(200);
    expect(res.json().result.matches).toEqual([
      { name: 'Michael Thornberry', phone: '+1•••-•••-0002' },
    ]);
  });

  it('HAPPY: match is case-insensitive (ILIKE, not LIKE)', async () => {
    // WHY: the LLM may emit any casing from speech; ALL-CAPS must still hit.
    const res = await findByName('MICHAEL THORNBERRY');
    expect(res.statusCode).toBe(200);
    expect(res.json().result.matches).toEqual([
      { name: 'Michael Thornberry', phone: '+1•••-•••-0002' },
    ]);
  });

  it("HAPPY: apostrophe in the name (O'Brien) matches and does not 500", async () => {
    // WHO: Sarah O'Brien — classic quoting-bug bait.
    // WHAT: the search term contains a single quote; parameterized ILIKE
    //       must treat it as data, not SQL.
    // WHY: a quoting bug here 500s on real Irish/French names in prod and
    //      only a real Postgres round-trip can prove it doesn't.
    const res = await findByName("O'Brien");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      result: { matches: [{ name: "Sarah O'Brien", phone: '+1•••-•••-0001' }] },
    });
  });

  it('HAPPY: multi-word search matches the concatenated first_name/last_name row', async () => {
    // WHO: a customer imported with first/last split and `name` NULL.
    // WHAT: the TRIM(COALESCE(first)||' '||COALESCE(last)) ILIKE branch —
    //       the exact SQL the mocked suite never executes.
    // WHY: without this branch every imported customer is unfindable;
    //      the display name must be derived ("Priya Patelsdottir"), never
    //      surface as "Unknown" for a real match.
    const res = await findByName('Priya Patelsdottir');
    expect(res.statusCode).toBe(200);
    expect(res.json().result.matches).toEqual([
      { name: 'Priya Patelsdottir', phone: '+1•••-•••-0003' },
    ]);
  });

  it('HAPPY: empty-string `name` column falls back to first/last for display (NULLIF)', async () => {
    // WHO: an imported row with name = '' (not NULL) — common CSV artifact.
    // WHY: without NULLIF(name,'') the route would return name:'' which the
    //      route's `m.name || 'Unknown'` maps to 'Unknown' — a real match
    //      surfacing as a stranger. Must come back as the derived name.
    const res = await findByName('Emptyfield');
    expect(res.statusCode).toBe(200);
    expect(res.json().result.matches).toEqual([
      { name: 'Emptyfield Nameless', phone: '+1•••-•••-0004' },
    ]);
  });

  it('HAPPY: more than 5 matches → capped at 5, newest updated_at first, oldest dropped', async () => {
    // WHO: six customers share the surname "Overflowsen" (family bookings).
    // WHAT: ORDER BY updated_at DESC NULLS LAST + LIMIT 5.
    // WHY: the agent reads at most 5 candidates to the caller; recency
    //      ordering means the most plausible (recently active) customer is
    //      offered first. Zephyrina-1 (oldest) must be the one cut.
    const res = await findByName('Overflowsen');
    expect(res.statusCode).toBe(200);
    const matches = res.json().result.matches as Array<{ name: string; phone: string }>;
    expect(matches).toHaveLength(5);
    expect(matches.map((m) => m.name)).toEqual([
      'Zephyrina Overflowsen 6',
      'Zephyrina Overflowsen 5',
      'Zephyrina Overflowsen 4',
      'Zephyrina Overflowsen 3',
      'Zephyrina Overflowsen 2',
    ]);
  });

  it('HAPPY: soft-deleted customers are excluded from results', async () => {
    // WHO: "Deleted Dorabella", is_deleted = true.
    // WHY: resurfacing a deleted customer's phone number to a caller is a
    //      privacy problem; the is_deleted filter must run for real.
    const res = await findByName('Dorabella');
    expect(res.statusCode).toBe(200);
    expect(res.json().result.matches).toEqual([]);
  });

  it('HAPPY: results never leak across tenants', async () => {
    // WHO: "Isolde Crosstenant" exists only in the OTHER tenant.
    // WHY: multi-tenant isolation — tenant A's agent must never read
    //      tenant B's customer names/phones to a caller.
    const res = await findByName('Isolde Crosstenant');
    expect(res.statusCode).toBe(200);
    expect(res.json().result.matches).toEqual([]);
  });

  it('SAD: no match returns an empty matches list (success:true), not an error', async () => {
    // WHO: a genuinely new caller whose name matches nobody.
    // WHY: the route contract treats "no match" as a normal outcome — the
    //      agent proceeds as new-caller; an error here would derail the call.
    const res = await findByName('Nonexistent Nobody Whatsoever');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, result: { matches: [] } });
  });

  it('SAD: whitespace-only name passes the schema but trims to empty → matches: []', async () => {
    // WHAT: '   ' satisfies z.string().min(1) yet the route trims it and
    //       short-circuits BEFORE the SQL — otherwise '%%' would ILIKE-match
    //       every customer in the tenant.
    // WHY: a transcription hiccup must not dump the whole address book.
    const res = await findByName('   ');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, result: { matches: [] } });
  });

  it('SAD: a "%" in the search term is matched LITERALLY, not as a wildcard (over-disclosure fix)', async () => {
    // WHO: an LLM-mangled name containing a percent sign.
    // WHAT: LIKE metacharacters are escaped before hitting '%'||$2||'%', so a
    //       bare '%' matches only names literally containing '%' — none exist
    //       here, so ZERO rows. Before the 2026-07-01 fix it acted as a
    //       wildcard and dumped 5 customers (names + phones) to the caller.
    // WHY: a transcription hiccup must not over-disclose the address book.
    const res = await findByName('%');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.result.matches).toHaveLength(0);

    // Same for underscore: '_' must not act as single-char wildcard — no
    // customer here has a literal underscore in their name.
    const underscore = await findByName('___');
    expect(underscore.json().result.matches).toHaveLength(0);
  });

  it('SAD: missing name is rejected by the Zod schema (success:false), no SQL runs', async () => {
    // WHY: validation must fail closed at the schema layer with the
    //      standard {success:false} tool shape the LLM can relay.
    const res = await post('/agent-tools/find-customer-by-name', { tenant_id: tenantId });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
  });

  it('SAD: non-UUID tenant_id is rejected by the Zod schema (success:false)', async () => {
    // WHY: a malformed tenant id must never reach withTenantClient/RLS.
    const res = await findByName('Michael', 'not-a-uuid');
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
  });

  it('SAD: wrong agent secret → 401 Unauthorized, no data returned', async () => {
    // WHO: anything without the shared secret (the routes are internet-facing).
    // WHY: customer names + phones behind this route; auth must fail closed.
    const res = await post(
      '/agent-tools/find-customer-by-name',
      { tenant_id: tenantId, name: 'Michael' },
      'wrong-secret'
    );
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ success: false, error: 'Unauthorized' });
  });

  it('SAD: missing agent secret header → 401 Unauthorized', async () => {
    // WHY: same gate, absent header — must be rejected before the handler.
    const res = await app.inject({
      method: 'POST',
      url: '/agent-tools/find-customer-by-name',
      payload: { tenant_id: tenantId, name: 'Michael' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ success: false, error: 'Unauthorized' });
  });
});
