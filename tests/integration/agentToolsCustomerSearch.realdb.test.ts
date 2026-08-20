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
 *   WHERE — agentTools.ts find-customer-by-name → near-exact name match
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
    // Plain `name` column — case-insensitive + honorific probes.
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
    // Three-part stored name — proves first+last decide the match, so a
    // middle name on the CRM row does not make a real caller unfindable.
    await insertCustomer({ phone: '+15552000007', name: 'Ignatius Bartholomew Vandersplat' });
    // Six duplicate rows carrying the SAME full name, staggered updated_at —
    // proves the 5-result cap and ORDER BY updated_at DESC (newest first,
    // oldest dropped). The names are deliberately identical: under the
    // near-exact rule a distinguishing suffix would become part of the name
    // and stop matching, so the MASKED PHONE is what tells the rows apart.
    // …0101 is oldest … …0106 is newest.
    for (let i = 1; i <= 6; i++) {
      await insertCustomer({
        phone: `+1555200010${i}`,
        name: 'Zephyrina Overflowsen',
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

describe('find-customer-by-name — near-exact name search against real Postgres', () => {
  it('HAPPY: exact full-name match returns that customer with their MASKED phone', async () => {
    // WHO: a returning caller who states their full name.
    // WHAT: near-exact match on the derived display name.
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

  it('SECURITY: a bare first name no longer returns anybody', async () => {
    // WHO: anyone probing with a common first name.
    // WHAT: one name part is refused outright — this used to ILIKE '%Michael%'
    //       and hand back a real customer plus the last four of their phone.
    // WHY: the enumeration bug in docs/TODO.md P0 §4b. The caller must already
    //      know BOTH parts of the name, which turns the route into a
    //      confirmation of an identity they supplied rather than a disclosure
    //      of one they guessed.
    const res = await findByName('Michael');
    expect(res.statusCode).toBe(200);
    expect(res.json().result.matches).toEqual([]);
  });

  it('SECURITY: a surname FRAGMENT no longer returns anybody', async () => {
    // WHO: "Thornberr" — the cheap substring probe the old unanchored
    //      ILIKE '%…%' happily answered.
    // WHY: a fragment is not a name. Failing closed treats the caller as new,
    //      which is the safe direction; the alternative confirmed who is a
    //      customer here to whoever typed nine letters.
    const res = await findByName('Thornberr');
    expect(res.statusCode).toBe(200);
    expect(res.json().result.matches).toEqual([]);
  });

  it('SECURITY: a shared surname does not enumerate the family that shares it', async () => {
    // WHO: six real customers named Overflowsen.
    // WHAT: the surname alone is one token → refused before any SQL runs.
    // WHY: this is the exact shape the fix exists for — a common surname used
    //      to return five names plus five sets of last-four digits.
    const res = await findByName('Overflowsen');
    expect(res.statusCode).toBe(200);
    expect(res.json().result.matches).toEqual([]);
  });

  it('HAPPY: match is case-insensitive', async () => {
    // WHY: the LLM may emit any casing from speech; ALL-CAPS must still hit.
    const res = await findByName('MICHAEL THORNBERRY');
    expect(res.statusCode).toBe(200);
    expect(res.json().result.matches).toEqual([
      { name: 'Michael Thornberry', phone: '+1•••-•••-0002' },
    ]);
  });

  it('HAPPY: an honorific the caller leads with is stripped, not counted', async () => {
    // WHO: "Mr. Michael Thornberry" — how people actually introduce themselves.
    // WHAT: `mr` is dropped before the two-part rule is applied, so this is
    //       still a two-part name and still matches.
    // WHY: the tightened match must reject fragments, not real callers.
    const res = await findByName('Mr. Michael Thornberry');
    expect(res.statusCode).toBe(200);
    expect(res.json().result.matches).toEqual([
      { name: 'Michael Thornberry', phone: '+1•••-•••-0002' },
    ]);
  });

  it('HAPPY: a middle name the CRM row carries does not break the match', async () => {
    // WHO: stored as "Ignatius Bartholomew Vandersplat", caller says the
    //      first and last parts only.
    // WHY: near-exact must not mean brittle — first + last decide, so a stored
    //      middle name or suffix is tolerated on either side.
    const res = await findByName('Ignatius Vandersplat');
    expect(res.statusCode).toBe(200);
    expect(res.json().result.matches).toEqual([
      { name: 'Ignatius Bartholomew Vandersplat', phone: '+1•••-•••-0007' },
    ]);
  });

  it("HAPPY: apostrophe in the name (O'Brien) matches and does not 500", async () => {
    // WHO: Sarah O'Brien — classic quoting-bug bait.
    // WHAT: the search term contains a single quote; the parameterized query
    //       must treat it as data, not SQL, and the apostrophe must be deleted
    //       identically on BOTH sides of the comparison (SQL `translate` and
    //       the TypeScript normalizer) or a real Irish name never matches.
    // WHY: a quoting bug here 500s on real Irish/French names in prod and
    //      only a real Postgres round-trip can prove it doesn't.
    const res = await findByName("Sarah O'Brien");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      result: { matches: [{ name: "Sarah O'Brien", phone: '+1•••-•••-0001' }] },
    });
  });

  it('HAPPY: multi-word search matches the concatenated first_name/last_name row', async () => {
    // WHO: a customer imported with first/last split and `name` NULL.
    // WHAT: the TRIM(COALESCE(first)||' '||COALESCE(last)) branch inside the
    //       candidate CTE — the exact SQL the mocked suite never executes.
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
    const res = await findByName('Emptyfield Nameless');
    expect(res.statusCode).toBe(200);
    expect(res.json().result.matches).toEqual([
      { name: 'Emptyfield Nameless', phone: '+1•••-•••-0004' },
    ]);
  });

  it('HAPPY: more than 5 identical full names → capped at 5, newest updated_at first', async () => {
    // WHO: six duplicate CRM rows for the same person/household name.
    // WHAT: ORDER BY updated_at DESC NULLS LAST in the prefilter, then the
    //       in-process filter slices to 5.
    // WHY: the agent reads at most 5 candidates to the caller; recency
    //      ordering means the most plausible (recently active) row is offered
    //      first. The oldest (…0101) must be the one cut. The names are
    //      identical by design, so the MASKED PHONE is what identifies which
    //      rows survived.
    const res = await findByName('Zephyrina Overflowsen');
    expect(res.statusCode).toBe(200);
    const matches = res.json().result.matches as Array<{ name: string; phone: string }>;
    expect(matches).toHaveLength(5);
    expect(matches.map((m) => m.phone)).toEqual([
      '+1•••-•••-0106',
      '+1•••-•••-0105',
      '+1•••-•••-0104',
      '+1•••-•••-0103',
      '+1•••-•••-0102',
    ]);
  });

  it('HAPPY: soft-deleted customers are excluded from results', async () => {
    // WHO: "Deleted Dorabella", is_deleted = true.
    // WHY: resurfacing a deleted customer's phone number to a caller is a
    //      privacy problem; the is_deleted filter must run for real.
    const res = await findByName('Deleted Dorabella');
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

  it('SAD: whitespace-only name passes the schema but normalizes to empty → matches: []', async () => {
    // WHAT: '   ' satisfies z.string().min(1) yet the route normalizes it to
    //       '' and short-circuits BEFORE the SQL.
    // WHY: a transcription hiccup must not reach the address book at all.
    const res = await findByName('   ');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, result: { matches: [] } });
  });

  it('SAD: punctuation-only input normalizes away and never reaches SQL', async () => {
    // WHAT: '%' and '___' carry no alphanumerics, so the normalizer returns ''
    //       and the two-part rule refuses them.
    // WHY: before the 2026-07-01 escaping fix a bare '%' acted as a LIKE
    //       wildcard and dumped 5 customers (names + phones) to the caller.
    //       The near-exact rewrite removes LIKE entirely, so the class is gone
    //       rather than escaped — this test pins that it stays gone.
    const res = await findByName('%');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.result.matches).toHaveLength(0);

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
    const res = await findByName('Michael Thornberry', 'not-a-uuid');
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
  });

  it('SAD: wrong agent secret → 401 Unauthorized, no data returned', async () => {
    // WHO: anything without the shared secret (the routes are internet-facing).
    // WHY: customer names + phones behind this route; auth must fail closed.
    const res = await post(
      '/agent-tools/find-customer-by-name',
      { tenant_id: tenantId, name: 'Michael Thornberry' },
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
      payload: { tenant_id: tenantId, name: 'Michael Thornberry' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ success: false, error: 'Unauthorized' });
  });
});
