/**
 * T-015-D: the starter catalogue is only as good as what the booking resolver
 * does with it. Real DB, real SQL, real pgvector.
 *
 * WHO: a caller ringing a shop that was set up from the wizard's defaults.
 * WHAT: three paths through `resolveServiceForBooking`, proven separately —
 *       SKU by name, look-first by MEANING, and the fallthrough default.
 * WHEN: every CI run that has a database.
 * WHERE: src/services/serviceResolver.ts + src/services/defaultServicePolicy.ts.
 * WHY: seeding names with no descriptions and letting the default fall out of
 *      alphabetical order produces silent WRONG bookings — the caller is booked,
 *      the tool returns success, and nobody finds out until someone turns up for
 *      an oil change with a car that wouldn't start.
 *
 * ── ON THE EMBEDDER ─────────────────────────────────────────────────────────
 * The semantic step is exercised with a DETERMINISTIC local embedder, not a
 * mock of the resolver and not the OpenAI API:
 *   - a mocked resolver would prove the branching, which tests/services/
 *     serviceResolver.test.ts already does, and would never touch
 *     `match_service_by_intent` or the pgvector operator that actually decides.
 *   - the real API would make CI depend on a network and a quota, and would make
 *     this test non-deterministic.
 * The embedder here is a bag-of-words hash into the same 1536 dimensions, so
 * cosine similarity behaves the way it does in production for the property under
 * test: shared vocabulary pulls a phrase onto a description. `INTENT_MATCH_THRESHOLD`
 * is NOT touched — a threshold lowered to make a test pass is the test lying.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Client } from 'pg';
import { getRootClient, clearDB, createTenant, skipIfDbDown } from '../utils';
import { resolveServiceForBooking } from '../../src/services/serviceResolver';
import { applyDefaultServicePolicy } from '../../src/services/defaultServicePolicy';
import { STARTER_SERVICES } from '../../shared/starterServices';

let root: Client;
let dbAvailable = false;
beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

beforeAll(async () => {
  try {
    root = await getRootClient();
    dbAvailable = true;
    await clearDB(root);
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (root) await root.end();
});

const DIMS = 1536;

/**
 * Deterministic bag-of-words embedder. Each token lands in a fixed bucket, so
 * two strings that share words point in a similar direction and two that share
 * none are near-orthogonal — the only property this test relies on.
 */
function localEmbedding(text: string): number[] {
  const vec = new Array<number>(DIMS).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
    vec[hash % DIMS] += 1;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}
const embed = async (text: string): Promise<number[]> => localEmbedding(text);

/** Seed a tenant from the real starter catalogue, exactly as the wizard would. */
async function seedFromTemplate(businessType: string): Promise<string> {
  const tenantId = await createTenant(
    root,
    `T015 ${businessType} ${Date.now()}`,
    businessType,
    'America/Chicago'
  );
  for (const starter of STARTER_SERVICES[businessType]) {
    // duration 30 for every row, matching what the wizard actually writes.
    await root.query(
      `INSERT INTO services (tenant_id, name, description, duration_minutes, is_auto_seeded)
       VALUES ($1, $2, $3, 30, true)`,
      [tenantId, starter.name, starter.description ?? null]
    );
  }
  return tenantId;
}

describe('starter services — booking resolution (real DB)', () => {
  it('SKU: a caller who names the work gets that exact service', async () => {
    // WHO: someone who knows what they want. WHAT: "oil change" → Oil Change.
    // WHY: the ILIKE branch must keep winning for named work — the semantic step
    //      is a fallback for the callers who CANNOT name it, not a replacement.
    const tenantId = await seedFromTemplate('auto-shop');
    const resolved = await resolveServiceForBooking(root, tenantId, 'oil change', embed);
    expect(resolved?.name).toBe('Oil Change');
  });

  it('LOOK-FIRST: check-engine language ranks the diagnostic visit ABOVE the oil change', async () => {
    // WHO: the caller this whole task exists for — something is wrong and they
    //      cannot name it. WHAT: their words land nearest the look-first row.
    // WHY: this is the failure that produced a real wrong booking on 2026-07-14
    //      (a six-month contract booked into a 15-minute "Personal Callback").
    //      The DESCRIPTION does the work: nothing in the NAME "Diagnostic visit"
    //      would ever pull a warning light onto it.
    //
    // ASSERTS RANKING, NOT THE THRESHOLD, AND THAT IS DELIBERATE. The local
    // embedder is a bag-of-words hash; it reproduces the DIRECTION of similarity
    // but not the magnitude an OpenAI embedding gives two sentences that mean the
    // same thing in different words. This phrase scores ~0.30 against it, under
    // the production INTENT_MATCH_THRESHOLD of 0.35. Lowering that constant to
    // turn this green would be the test lying about the product, so it is left
    // alone and the assertion is the part that is genuinely provable offline:
    // given the descriptions, the right row is NEAREST. Whether a real embedding
    // clears 0.35 is a production property, exercised by ./scripts/simulate.sh
    // rag and by live calls — not something a hermetic test can honestly claim.
    const tenantId = await seedFromTemplate('auto-shop');

    // Embed exactly what the resolver embeds: name + subtitle + description.
    const services = await root.query<{ service_id: string; text: string }>(
      `SELECT service_id,
              concat_ws('. ', name, NULLIF(subtitle, ''), NULLIF(description, '')) AS text
         FROM services WHERE tenant_id = $1`,
      [tenantId]
    );
    for (const row of services.rows) {
      await root.query('UPDATE services SET embedding = $1::vector WHERE service_id = $2', [
        JSON.stringify(localEmbedding(row.text)),
        row.service_id,
      ]);
    }

    const spoken = 'my check engine warning light came on and it is making a noise';
    const ranked = await root.query<{ name: string; similarity: number }>(
      `SELECT * FROM match_service_by_intent($1, $2::vector)`,
      [tenantId, JSON.stringify(localEmbedding(spoken))]
    );

    expect(ranked.rows.length).toBeGreaterThan(0);
    expect(
      ranked.rows[0].name,
      `nearest service for "${spoken}" was ${ranked.rows[0].name}; ` +
        `full ranking: ${ranked.rows.map((r) => `${r.name}=${r.similarity.toFixed(3)}`).join(', ')}`
    ).toBe('Diagnostic visit');

    // Oil Change must not outrank it. In practice it does not even appear:
    // match_service_by_intent drops rows with no similarity at all, and
    // "Oil Change" shares no vocabulary with a warning light. Absent is the
    // strongest form of "did not win", so both outcomes are accepted — what is
    // NOT accepted is Oil Change scoring at or above the diagnostic row.
    const oilChange = ranked.rows.find((r) => r.name === 'Oil Change');
    if (oilChange) {
      expect(ranked.rows[0].similarity).toBeGreaterThan(oilChange.similarity);
    } else {
      expect(ranked.rows.map((r) => r.name)).not.toContain('Oil Change');
    }
  });

  it('LOOK-FIRST: with descriptions stripped, the same words no longer find the diagnostic row', async () => {
    // The control. If the ranking above held with name-only rows, the
    // description would be decoration and this whole task would be cosmetic.
    // Seeding names WITHOUT descriptions is what the wizard used to do.
    const tenantId = await createTenant(
      root,
      `T015 nodesc ${Date.now()}`,
      'auto-shop',
      'America/Chicago'
    );
    for (const starter of STARTER_SERVICES['auto-shop']) {
      await root.query(
        `INSERT INTO services (tenant_id, name, duration_minutes, is_auto_seeded)
         VALUES ($1, $2, 30, true)`,
        [tenantId, starter.name]
      );
    }
    const services = await root.query<{ service_id: string; text: string }>(
      `SELECT service_id, name AS text FROM services WHERE tenant_id = $1`,
      [tenantId]
    );
    for (const row of services.rows) {
      await root.query('UPDATE services SET embedding = $1::vector WHERE service_id = $2', [
        JSON.stringify(localEmbedding(row.text)),
        row.service_id,
      ]);
    }

    const ranked = await root.query<{ name: string; similarity: number }>(
      `SELECT * FROM match_service_by_intent($1, $2::vector)`,
      [
        tenantId,
        JSON.stringify(
          localEmbedding('my check engine warning light came on and it is making a noise')
        ),
      ]
    );
    // Name-only, "Diagnostic visit" shares no word with what the caller said.
    const top = ranked.rows[0];
    expect(
      top === undefined || top.similarity === 0 || top.name !== 'Diagnostic visit',
      `name-only seeding still ranked "Diagnostic visit" first — if that is genuinely true, ` +
        `the descriptions are not carrying the match and this task's premise needs revisiting`
    ).toBe(true);
  });

  it('LOOK-FIRST: a plumbing caller who describes a leak reaches the service call', async () => {
    const tenantId = await seedFromTemplate('plumber');
    const resolved = await resolveServiceForBooking(
      root,
      tenantId,
      'there is a leak and water is coming out under the sink',
      embed
    );
    expect(resolved?.name).toBe('Service call');
  });

  it('FALLTHROUGH: vague speech books the POLICY default, not the alphabetical first', async () => {
    // THE discriminating case, and the reason defaultServicePolicy.ts exists.
    // A plumber's starters are "Service call" and "Drain cleaning". The old
    // backfill ordered by `ABS(duration - 30), name ASC` and the wizard writes
    // 30 minutes for every row — so the duration term always ties and the ONLY
    // term that runs is the alphabetical one, which picks "Drain cleaning".
    // A caller who cannot say what is wrong would be booked for a drain clean.
    const tenantId = await seedFromTemplate('plumber');

    const applied = await applyDefaultServicePolicy(root, tenantId);
    expect(applied.applied).toBe(true);
    expect(applied.serviceName).toBe('Service call');

    // Deliberately no embedder: this proves branch 2 (the default), not the
    // semantic step. Words that name nothing in the catalogue.
    const resolved = await resolveServiceForBooking(root, tenantId, 'umm I am not really sure');
    expect(resolved?.name).toBe('Service call');

    // Spell out what the old ordering would have produced, so a regression that
    // reinstates it fails HERE with the reason attached rather than silently.
    const alphabetical = await root.query<{ name: string }>(
      `SELECT name FROM services WHERE tenant_id = $1 AND COALESCE(is_deleted,false)=false
        ORDER BY ABS(COALESCE(duration_minutes,30) - 30) ASC, name ASC LIMIT 1`,
      [tenantId]
    );
    expect(alphabetical.rows[0].name).toBe('Drain cleaning');
    expect(resolved?.name).not.toBe(alphabetical.rows[0].name);
  });

  it('FALLTHROUGH: a specialty-SKU shop defaults to its main SKU, not a consult', async () => {
    // The mirror of the rule. oil-change defaults to "Oil Change" — the caller
    // who mumbles at a quick-lube almost certainly wants the thing it does.
    const tenantId = await seedFromTemplate('oil-change');
    const applied = await applyDefaultServicePolicy(root, tenantId);
    expect(applied.serviceName).toBe('Oil Change');

    const resolved = await resolveServiceForBooking(root, tenantId, 'not sure what I need');
    expect(resolved?.name).toBe('Oil Change');
  });

  it('SAD: the policy never overwrites a default the owner already chose', async () => {
    // WHO: an owner who deliberately set their fallthrough in the dashboard.
    // WHY: re-running the wizard must not silently move it back.
    const tenantId = await seedFromTemplate('plumber');
    const chosen = await root.query<{ service_id: string }>(
      `SELECT service_id FROM services WHERE tenant_id = $1 AND name = 'Drain cleaning'`,
      [tenantId]
    );
    await root.query('UPDATE tenants SET default_service_id = $1 WHERE tenant_id = $2', [
      chosen.rows[0].service_id,
      tenantId,
    ]);

    const applied = await applyDefaultServicePolicy(root, tenantId);
    expect(applied.applied).toBe(false);

    const after = await root.query<{ default_service_id: string }>(
      'SELECT default_service_id FROM tenants WHERE tenant_id = $1',
      [tenantId]
    );
    expect(after.rows[0].default_service_id).toBe(chosen.rows[0].service_id);
  });

  it('SAD: a dangling default (service soft-deleted) is repaired, not left broken', async () => {
    // A default pointing at a deleted service is WORSE than none: the
    // fallthrough JOIN finds nothing and drops to the last-resort
    // "closest to 30 minutes, name ASC" net — the alphabetical lottery again.
    const tenantId = await seedFromTemplate('plumber');
    const drain = await root.query<{ service_id: string }>(
      `SELECT service_id FROM services WHERE tenant_id = $1 AND name = 'Drain cleaning'`,
      [tenantId]
    );
    await root.query('UPDATE tenants SET default_service_id = $1 WHERE tenant_id = $2', [
      drain.rows[0].service_id,
      tenantId,
    ]);
    await root.query('UPDATE services SET is_deleted = true WHERE service_id = $1', [
      drain.rows[0].service_id,
    ]);

    const applied = await applyDefaultServicePolicy(root, tenantId);
    expect(applied.applied).toBe(true);
    expect(applied.serviceName).toBe('Service call');
  });
});
