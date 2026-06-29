# Website Knowledge Import — Plan 1: Question Bank DB

> **⚠️ SUPERSEDED (2026-06-29) — NOT IMPLEMENTED, kept as design history.** This
> plan's three-table DB question bank (`question_bank`, `question_business_type`,
> `tenant_custom_question`) + `GET /knowledge/questions` resolver was NOT built.
> The question bank shipped via **PR #45** as a **TS constant** (`shared/questionBank.ts`),
> with no DB tables and **business-type filtering intentionally dropped**. Do NOT
> execute the checkboxes below — they describe an abandoned approach. Source of
> truth: `shared/questionBank.ts`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static global policy-question list with a database-backed question bank that serves each tenant a question set filtered by business type, plus per-tenant custom questions.

**Architecture:** Three tables — `question_bank` (shared questions), `question_business_type` (which business types a non-universal question applies to), `tenant_custom_question` (per-tenant additions). A resolver service composes a tenant's set as `universal ∪ type-matched ∪ custom`. A new `GET /knowledge/questions` endpoint returns it; the dashboard questionnaire reads the endpoint instead of the static file.

**Tech Stack:** Postgres (Supabase migrations, plain SQL), Fastify (TypeScript), `pg` Pool with `withTenantClient`, Vitest (unit + DB-integration via `src/test-utils.ts`), React dashboard.

This is the first of three plans for the feature (see spec `docs/superpowers/specs/2026-06-09-website-knowledge-import-design.md`). Plan 2 = scrape/extract engine. Plan 3 = suggestion review UI + approve→embed. Plan 1 ships value alone: business-type-filtered questionnaire.

---

## File Structure

- Create: `supabase/migrations/20260609000000_question_bank.sql` — the 3 tables + RLS + indexes.
- Create: `shared/questionBank.ts` — canonical seed array (moved from `dashboard/lib/policyQuestions.ts`) with an added optional `businessTypes` tag. Single source of truth for both seed and dashboard fallback.
- Create: `src/scripts/seedQuestionBank.ts` — idempotent upsert of the canonical array into `question_bank` + `question_business_type`.
- Create: `src/services/questionSet.ts` — `resolveQuestionSet(client, tenantId, businessType)`.
- Create: `src/services/questionSet.test.ts` — DB-integration tests for the resolver.
- Modify: `src/routes/knowledge.ts` — add `GET /knowledge/questions`.
- Modify: `dashboard/lib/policyQuestions.ts` — re-export from `shared/questionBank.ts` (keep the named exports stable so existing imports don't break).
- Modify: `dashboard/components/KnowledgeBaseView.tsx` — fetch the resolved set from the API; fall back to the static array on fetch failure.

---

## Task 1: Migration — question bank tables

**Files:**
- Create: `supabase/migrations/20260609000000_question_bank.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Question bank: business-type-aware policy questions for the AI receptionist.
-- Replaces the static dashboard/lib/policyQuestions.ts global list.

-- Shared questions, keyed by a stable slug (matches the old PolicyQuestion.id).
CREATE TABLE IF NOT EXISTS question_bank (
    id              TEXT PRIMARY KEY,             -- e.g. 'walk-ins-accepted'
    question        TEXT NOT NULL,
    placeholder     TEXT NOT NULL DEFAULT '',     -- example answer
    category        TEXT NOT NULL,
    applies_to_all  BOOLEAN NOT NULL DEFAULT false,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Many-to-many: which business types each non-universal question applies to.
CREATE TABLE IF NOT EXISTS question_business_type (
    question_id     TEXT NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
    business_type   TEXT NOT NULL,
    PRIMARY KEY (question_id, business_type)
);

CREATE INDEX IF NOT EXISTS question_business_type_bt_idx
    ON question_business_type (business_type);

-- Per-tenant custom questions (owner-added or, in Plan 2, scrape-discovered).
CREATE TABLE IF NOT EXISTS tenant_custom_question (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    question    TEXT NOT NULL,
    category    TEXT,
    origin      TEXT NOT NULL DEFAULT 'owner',     -- 'owner' | 'scrape'
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_custom_question_tenant_idx
    ON tenant_custom_question (tenant_id);

ALTER TABLE tenant_custom_question ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'tenant_custom_question'
          AND policyname = 'Custom questions isolated by tenant_id'
    ) THEN
        CREATE POLICY "Custom questions isolated by tenant_id" ON tenant_custom_question
            FOR ALL
            USING (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::UUID);
    END IF;
END
$$;
```

- [ ] **Step 2: Apply the migration to the local/test database**

Run: `psql "$DATABASE_URL" -f supabase/migrations/20260609000000_question_bank.sql`
Expected: `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE` / `DO` succeed with no error. Re-running is safe (all `IF NOT EXISTS`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260609000000_question_bank.sql
git commit -m "feat(knowledge): add question bank tables (bank, business-type map, custom)"
```

---

## Task 2: Canonical question source in shared/

**Files:**
- Create: `shared/questionBank.ts`
- Modify: `dashboard/lib/policyQuestions.ts`

- [ ] **Step 1: Create the shared canonical array**

Copy the full `POLICY_CATEGORIES` and `POLICY_QUESTIONS` arrays from the current
`dashboard/lib/policyQuestions.ts` into `shared/questionBank.ts`, extending the
interface with an optional `businessTypes` tag. Universal questions omit the field;
type-specific questions list the `business_type` slugs they apply to (slugs as used
in the `tenants.business_type` / `business_templates` tables, e.g. `'auto-shop'`,
`'salon'`, `'mobile-tire'`, `'personal-trainer'`).

```ts
// shared/questionBank.ts
export interface BankQuestion {
  id: string;
  question: string;
  placeholder: string;
  category: string;
  /** Omitted/empty = universal (applies to all business types). */
  businessTypes?: string[];
}

export const POLICY_CATEGORIES: string[] = [
  'Business Hours & Location',
  'Services & Pricing',
  'Scheduling & Appointments',
  'Cancellation & Rescheduling',
  'Payment & Billing',
  'Your Guarantee',
  'Before Your Visit',
  'Discounts & Promotions',
  'Emergency & After-Hours',
];

export const POLICY_QUESTIONS: BankQuestion[] = [
  // ── Paste EVERY entry from dashboard/lib/policyQuestions.ts here, unchanged,
  //    EXCEPT add `businessTypes` to the type-specific ones below. ──
  // ... (all existing universal questions: hours, location, services, etc.) ...

  // Example type-specific additions (NEW — not in the old file):
  {
    id: 'insurance-accepted',
    question: 'Do you work with insurance, and which providers?',
    placeholder:
      'Yes, we work directly with most major insurers for covered repairs. Bring your claim number and we will handle the paperwork.',
    category: 'Payment & Billing',
    businessTypes: ['auto-shop', 'body-shop'],
  },
];
```

> NOTE: This step is a mechanical move + tag. Do not paraphrase question text —
> the `id` slugs must stay identical to the old file so existing saved answers
> (keyed by question id) keep matching.

- [ ] **Step 2: Re-export from the dashboard file to keep existing imports working**

```ts
// dashboard/lib/policyQuestions.ts
// Canonical source now lives in shared/. Re-exported so existing imports
// (KnowledgeBaseView, wizard steps) keep working unchanged.
export type { BankQuestion as PolicyQuestion } from '../../shared/questionBank';
export { POLICY_CATEGORIES, POLICY_QUESTIONS } from '../../shared/questionBank';
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: `tsc` exits 0, no errors. (If the dashboard has a separate tsconfig, also run `cd dashboard && npx tsc --noEmit`.)

- [ ] **Step 4: Commit**

```bash
git add shared/questionBank.ts dashboard/lib/policyQuestions.ts
git commit -m "refactor(knowledge): move question list to shared/, add businessTypes tag"
```

---

## Task 3: Seed script

**Files:**
- Create: `src/scripts/seedQuestionBank.ts`

- [ ] **Step 1: Write the seed script**

```ts
// src/scripts/seedQuestionBank.ts
// Idempotent upsert of the canonical question array into the DB question bank.
// Run: npx tsx src/scripts/seedQuestionBank.ts   (or via the build output)
import { getPool, closePool } from '../database';
import { POLICY_QUESTIONS } from '../../shared/questionBank';

async function seed(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < POLICY_QUESTIONS.length; i++) {
      const q = POLICY_QUESTIONS[i];
      const appliesToAll = !q.businessTypes || q.businessTypes.length === 0;
      await client.query(
        `INSERT INTO question_bank (id, question, placeholder, category, applies_to_all, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           question = EXCLUDED.question,
           placeholder = EXCLUDED.placeholder,
           category = EXCLUDED.category,
           applies_to_all = EXCLUDED.applies_to_all,
           sort_order = EXCLUDED.sort_order`,
        [q.id, q.question, q.placeholder, q.category, appliesToAll, i]
      );
      await client.query('DELETE FROM question_business_type WHERE question_id = $1', [q.id]);
      for (const bt of q.businessTypes ?? []) {
        await client.query(
          `INSERT INTO question_business_type (question_id, business_type)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [q.id, bt]
        );
      }
    }
    await client.query('COMMIT');
    console.log(`Seeded ${POLICY_QUESTIONS.length} questions into question_bank.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await closePool();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the seed against the local/test DB**

Run: `npx tsx src/scripts/seedQuestionBank.ts`
Expected: prints `Seeded N questions into question_bank.` and exits 0.
Verify: `psql "$DATABASE_URL" -c "SELECT count(*) FROM question_bank;"` returns N;
`psql "$DATABASE_URL" -c "SELECT count(*) FROM question_business_type;"` returns ≥ 1.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/seedQuestionBank.ts
git commit -m "feat(knowledge): seed script for question bank from canonical array"
```

---

## Task 4: Resolver service

**Files:**
- Create: `src/services/questionSet.ts`
- Test: `src/services/questionSet.test.ts`

- [ ] **Step 1: Write the failing DB-integration test**

```ts
// src/services/questionSet.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  getRootClient,
  clearDB,
  createTenant,
  beginTestTransaction,
  rollbackTestTransaction,
  skipIfDbDown,
} from '../test-utils';
import { type Client } from 'pg';
import { resolveQuestionSet } from './questionSet';

describe('resolveQuestionSet', () => {
  let client: Client;
  let dbAvailable = true;
  beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

  beforeAll(async () => {
    try {
      client = await getRootClient();
      await clearDB(client);
      // Seed a universal + a type-specific + a non-matching type-specific question.
      await client.query(
        `INSERT INTO question_bank (id, question, placeholder, category, applies_to_all, sort_order)
         VALUES
           ('q-hours','What are your hours?','','Hours',true,0),
           ('q-insurance','Insurance?','','Billing',false,1),
           ('q-walkins','Walk-ins?','','Hours',false,2)`
      );
      await client.query(
        `INSERT INTO question_business_type (question_id, business_type) VALUES
           ('q-insurance','auto-shop'),
           ('q-walkins','salon')`
      );
    } catch (err) {
      dbAvailable = false;
      console.warn('[questionSet.test] Skipping DB tests - connection failed', err);
    }
  });

  afterAll(async () => {
    if (dbAvailable && client) await client.end();
  });
  beforeEach(async () => {
    if (dbAvailable) await beginTestTransaction(client);
  });
  afterEach(async () => {
    if (dbAvailable) await rollbackTestTransaction(client);
  });

  it('HAPPY: auto-shop gets universal + auto-shop questions, not salon ones', async () => {
    const tenantId = await createTenant(client, { businessType: 'auto-shop' });
    const set = await resolveQuestionSet(client, tenantId, 'auto-shop');
    const ids = set.map((q) => q.id);
    expect(ids).toContain('q-hours');     // universal
    expect(ids).toContain('q-insurance'); // matches auto-shop
    expect(ids).not.toContain('q-walkins'); // salon only
  });

  it('HAPPY: includes the tenant custom questions', async () => {
    const tenantId = await createTenant(client, { businessType: 'auto-shop' });
    await client.query(
      `INSERT INTO tenant_custom_question (tenant_id, question, category, origin)
       VALUES ($1, 'Do you offer loaner cars?', 'Services', 'owner')`,
      [tenantId]
    );
    const set = await resolveQuestionSet(client, tenantId, 'auto-shop');
    expect(set.some((q) => q.question === 'Do you offer loaner cars?')).toBe(true);
  });

  it('SAD: a business type with no type-specific matches still gets universal', async () => {
    // WHO: a bakery owner onboarding. WHAT: no insurance/walk-in questions exist
    // for 'bakery'. WHERE: resolveQuestionSet. WHY: universal questions must
    // always appear so the questionnaire is never empty.
    const tenantId = await createTenant(client, { businessType: 'bakery' });
    const set = await resolveQuestionSet(client, tenantId, 'bakery');
    const ids = set.map((q) => q.id);
    expect(ids).toContain('q-hours');
    expect(ids).not.toContain('q-insurance');
    expect(ids).not.toContain('q-walkins');
  });
});
```

> If `createTenant`'s option key differs from `{ businessType }` in `src/test-utils.ts`, use the actual key (check the helper signature before running).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/services/questionSet.test.ts`
Expected: FAIL — `resolveQuestionSet` is not exported / module not found.

- [ ] **Step 3: Write the resolver**

```ts
// src/services/questionSet.ts
import type { ClientBase } from 'pg';

export interface ResolvedQuestion {
  id: string;          // bank slug, or 'custom:<uuid>' for custom questions
  question: string;
  placeholder: string;
  category: string;
  origin: 'bank' | 'custom';
}

/**
 * Resolve the full ordered question set for a tenant:
 *   universal bank questions ∪ bank questions tagged for this business type
 *   ∪ the tenant's custom questions.
 */
export async function resolveQuestionSet(
  client: ClientBase,
  tenantId: string,
  businessType: string
): Promise<ResolvedQuestion[]> {
  const bank = await client.query(
    `SELECT qb.id, qb.question, qb.placeholder, qb.category
       FROM question_bank qb
      WHERE qb.applies_to_all = true
         OR EXISTS (
           SELECT 1 FROM question_business_type qbt
            WHERE qbt.question_id = qb.id AND qbt.business_type = $1
         )
      ORDER BY qb.sort_order, qb.id`,
    [businessType]
  );

  const custom = await client.query(
    `SELECT id, question, COALESCE(category, '') AS category
       FROM tenant_custom_question
      WHERE tenant_id = $1
      ORDER BY created_at`,
    [tenantId]
  );

  const bankQs: ResolvedQuestion[] = bank.rows.map((r) => ({
    id: r.id,
    question: r.question,
    placeholder: r.placeholder,
    category: r.category,
    origin: 'bank',
  }));

  const customQs: ResolvedQuestion[] = custom.rows.map((r) => ({
    id: `custom:${r.id}`,
    question: r.question,
    placeholder: '',
    category: r.category,
    origin: 'custom',
  }));

  return [...bankQs, ...customQs];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/services/questionSet.test.ts`
Expected: PASS (3 tests). If the DB is down the suite is skipped via `skipIfDbDown` — bring the test DB up so it actually runs.

- [ ] **Step 5: Commit**

```bash
git add src/services/questionSet.ts src/services/questionSet.test.ts
git commit -m "feat(knowledge): resolveQuestionSet composes universal + type + custom"
```

---

## Task 5: API endpoint GET /knowledge/questions

**Files:**
- Modify: `src/routes/knowledge.ts` (add the route alongside the existing handlers)
- Test: add a case to a route-level test, or extend `src/services/questionSet.test.ts` if route tests live elsewhere — match the existing pattern in `src/crud-routes.test.ts`.

- [ ] **Step 1: Add the route handler**

Inside `registerKnowledgeRoutes`, after the existing `GET /knowledge` handler, add:

```ts
app.get(
  '/knowledge/questions',
  withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const result = await withTenantClient(tenantId, async (client) => {
      const t = await client.query(
        'SELECT COALESCE(business_type, $2) AS business_type FROM tenants WHERE tenant_id = $1',
        [tenantId, 'general']
      );
      const businessType = t.rows[0]?.business_type ?? 'general';
      return resolveQuestionSet(client, tenantId, businessType);
    });

    return reply.send({ success: true, questions: result });
  }, 'Failed to fetch question set')
);
```

Add the import at the top of `src/routes/knowledge.ts`:

```ts
import { resolveQuestionSet } from '../services/questionSet';
```

> Verify the tenants PK column name (`tenant_id` vs `id`) against
> `supabase/migrations/20260228000000_initial_schema.sql` before running; use the
> actual column.

- [ ] **Step 2: Typecheck + run the existing knowledge tests**

Run: `npm run build && npm test -- src/services/questionSet.test.ts`
Expected: build exits 0; tests still PASS.

- [ ] **Step 3: Manual smoke (optional, if a dev server + token is handy)**

Run: `curl -s -H "Authorization: Bearer $DEV_JWT" localhost:$PORT/knowledge/questions | head`
Expected: JSON `{ "success": true, "questions": [ { "id": "...", "question": "...", "origin": "bank" }, ... ] }`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/knowledge.ts
git commit -m "feat(knowledge): GET /knowledge/questions returns tenant question set"
```

---

## Task 6: Dashboard reads the endpoint

**Files:**
- Modify: `dashboard/components/KnowledgeBaseView.tsx`

- [ ] **Step 1: Fetch the resolved set, fall back to the static array**

Replace the direct use of the imported `POLICY_QUESTIONS` with state loaded from the
API, keeping the static import as the fallback when the request fails. Match the
component's existing data-fetching pattern (it already calls the knowledge API).

```tsx
// near the top of the component body
const [questions, setQuestions] = useState<PolicyQuestion[]>(POLICY_QUESTIONS);

useEffect(() => {
  let cancelled = false;
  void (async () => {
    try {
      const res = await fetch('/knowledge/questions', { headers: authHeaders() });
      if (!res.ok) return; // keep static fallback
      const data = (await res.json()) as { questions: PolicyQuestion[] };
      if (!cancelled && Array.isArray(data.questions) && data.questions.length > 0) {
        setQuestions(data.questions);
      }
    } catch {
      // network error → keep static fallback (questionnaire still usable)
    }
  })();
  return () => {
    cancelled = true;
  };
}, []);
```

Then render from `questions` instead of `POLICY_QUESTIONS`. Use the same
`authHeaders()` / fetch helper the file already uses for other knowledge calls
(check the file for the existing pattern — do not invent a new auth mechanism).

- [ ] **Step 2: Run dashboard typecheck + tests**

Run: `cd dashboard && npx tsc --noEmit && npx vitest run`
Expected: typecheck clean; existing dashboard tests pass.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components/KnowledgeBaseView.tsx
git commit -m "feat(dashboard): questionnaire reads question set from API with static fallback"
```

---

## Plan 1 Self-Review

- **Spec coverage:** Implements spec §"What is new — 1. Question bank database" (universal / type-specific / per-tenant custom) and the business-type filtering Dale emphasized. The scrape (§2), suggestions/review (§3), and empty-vs-unanswered (§4) are Plans 2 & 3.
- **Type consistency:** `resolveQuestionSet(client, tenantId, businessType) → ResolvedQuestion[]` used identically in the test, the service, and the route. `BankQuestion` (shared) re-exported as `PolicyQuestion` for the dashboard. Custom ids are namespaced `custom:<uuid>` so they never collide with bank slugs.
- **Open verifications flagged inline:** `createTenant` option key, `tenants` PK column name, dashboard auth-header helper — each step says to confirm against the real code before running.

---

## Plans 2 & 3 — roadmap (expanded to full bite-sized detail when reached)

**Plan 2 — Scrape + Extract engine.** New migration `knowledge_suggestion` table (per spec §"Storage & flow"). Service `src/services/websiteScrape.ts`: bounded same-origin crawl (≤8 pages, size/time caps) → HTML→text. Service `src/services/answerExtraction.ts`: single structured LLM call (site text + resolved question set as a delimited untrusted data block) → `{questionId, answer|null, sourceUrl, confidence}[]` + `discovered[]`. Endpoint `POST /knowledge/import-website` writes `knowledge_suggestion` rows (status `suggested`) + `tenant_custom_question` rows (origin `scrape`) for discovered topics. Prompt-injection containment + graceful no-site fallback are explicit tasks. Ships: backend import producing reviewable suggestions.

**Plan 3 — Suggestion review UI + approve→embed.** Endpoints: `GET /knowledge/suggestions`, `POST /knowledge/suggestions/:id/approve` (calls existing `prepareQADocument` → insert `tenant_docs`, mark suggestion `confirmed`), `.../reject`. Dashboard review screen extending `KnowledgeBaseView`: per-question `suggested`/`confirmed`/`empty` state, "from website ✓ [source]" badge + confidence, Approve / Edit-then-approve / Empty-write-it, and "Approve all high-confidence". Empty-vs-unanswered surfaced distinctly. Ships: the full owner review loop; only confirmed Q&A embeds to live RAG.
