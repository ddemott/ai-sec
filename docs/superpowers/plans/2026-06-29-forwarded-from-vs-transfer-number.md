# Forwarded-From vs Transfer Number Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the overloaded `tenants.forward_phone` into a new `forwarded_from_phone` (inbound caller-ID match) vs `forward_phone` (live-transfer target), with a save-time loop guard.

**Architecture:** Add one nullable DB column. A pure `phonesWouldLoop()` guard rejects a save where the transfer number collides with the forwarded-from number or the AI's own DID. The agent's forwarded-line caller-ID match repoints from `forward_phone` → `forwarded_from_phone`; the coarse env-list guard stays for back-compat. Dashboard gets a second phone field with a client-side mirror of the guard.

**Tech Stack:** Fastify + pg (backend), LiveKit Agents Node (agent), Next.js 14 + React (dashboard), Vitest, Postgres migration.

## Global Constraints

- Phone normalization is `normalizePhone()` from `shared/phone.ts` — strict E.164 (`+1XXXXXXXXXX`); `< 10 digits → null`. Use it for ALL phone comparison + storage. Verbatim import paths: backend `../../shared/phone` from `src/services/`, dashboard `../../shared/phone` from `dashboard/components/` is already used as `normalizePhone`.
- New column is **nullable**; deploy must be forward-compatible (reads use `?? null`).
- PK/naming + snake_case DB columns, camelCase TS at the agent boundary (existing convention).
- Tests cover happy + sad with 5W comments (WHO/WHAT/WHEN/WHERE/WHY).
- Backend route is `POST /tenants/:id/update-config` (NOT `/config`).
- Migration number must exceed the latest `20260625010000`. Use `20260629000000`.
- After any migration: regenerate `supabase/baseline.sql` via `npm run db:baseline`.

---

### Task 1: DB migration — add `forwarded_from_phone`

**Files:**
- Create: `supabase/migrations/20260629000000_tenant_forwarded_from_phone.sql`
- Modify: `supabase/baseline.sql` (regenerated, not hand-edited)

**Interfaces:**
- Produces: `tenants.forwarded_from_phone TEXT` (nullable) for all later tasks.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260629000000_tenant_forwarded_from_phone.sql
-- The line a tenant forwards INTO the assistant (caller-ID match → collect the
-- caller's real number by voice). Distinct from forward_phone (the live-transfer
-- target) so the two can't be the same number and loop the call back to the AI.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS forwarded_from_phone TEXT;

COMMENT ON COLUMN tenants.forwarded_from_phone IS
  'E.164 line that forwards calls into the assistant. When the SIP caller-ID matches this, the agent nulls callerPhone and collects the caller''s real number verbally. Distinct from forward_phone (transfer target).';
```

- [ ] **Step 2: Apply against a scratch DB to verify it parses**

Run: `npm run db:migrate -- "postgres://postgres:postgres@localhost:5433/test_db"`
Expected: migration `20260629000000` applies with no error.

- [ ] **Step 3: Regenerate the baseline snapshot**

Run: `npm run db:baseline`
Expected: `supabase/baseline.sql` now contains `forwarded_from_phone` (grep it: `grep forwarded_from_phone supabase/baseline.sql` → one hit in the `tenants` table block).

- [ ] **Step 4: Verify the schema-alignment guard passes**

Run: `npx vitest run scripts/verify-schema-alignment.test.ts`
Expected: PASS (the new column is present in baseline, so `checkMigrationColumnsInBaseline` is satisfied).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260629000000_tenant_forwarded_from_phone.sql supabase/baseline.sql
git commit -m "feat(db): add tenants.forwarded_from_phone column"
```

---

### Task 2: Pure loop-guard function

**Files:**
- Create: `src/services/phoneLoopGuard.ts`
- Test: `src/services/phoneLoopGuard.test.ts`

**Interfaces:**
- Consumes: `normalizePhone` from `shared/phone.ts`.
- Produces: `phonesWouldLoop(forwardPhone, forwardedFromPhone, inboundPhone): boolean` — true when `forwardPhone` is non-null and normalizes equal to `forwardedFromPhone` OR `inboundPhone`. Used by Task 3.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/phoneLoopGuard.test.ts
import { describe, it, expect } from 'vitest';
import { phonesWouldLoop } from './phoneLoopGuard';

describe('phonesWouldLoop', () => {
  // WHO: owner saving call-routing config. WHAT: detect a transfer target that
  // loops back into the AI. WHEN: on save. WHERE: backend guard + UI mirror.
  // WHY: forwarding "talk to a person" to the line that forwards INTO the AI
  // (or to the AI's own DID) makes the call loop forever.
  it('flags transfer == forwarded-from, any format', () => {
    expect(phonesWouldLoop('+16082175303', '608-217-5303', null)).toBe(true);
    expect(phonesWouldLoop('(608) 217-5303', '+16082175303', null)).toBe(true);
  });

  it('flags transfer == inbound DID', () => {
    expect(phonesWouldLoop('+16308669086', null, '6308669086')).toBe(true);
  });

  it('allows distinct numbers', () => {
    expect(phonesWouldLoop('+16308669086', '+16082175303', '+16305551234')).toBe(false);
  });

  it('no transfer number set → never loops', () => {
    expect(phonesWouldLoop(null, '+16082175303', '+16308669086')).toBe(false);
    expect(phonesWouldLoop('', '+16082175303', '+16308669086')).toBe(false);
  });

  it('ignores un-normalizable garbage (treated as no-match, not a false loop)', () => {
    expect(phonesWouldLoop('123', '+16082175303', null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/phoneLoopGuard.test.ts`
Expected: FAIL — `phonesWouldLoop` not defined.

- [ ] **Step 3: Write the implementation**

```ts
// src/services/phoneLoopGuard.ts
import { normalizePhone } from '../../shared/phone';

/**
 * True when forwardPhone (the live-transfer target) would loop a call back
 * into the assistant — i.e. it equals the forwarded-from line OR the AI's own
 * inbound DID. Comparison is on strict E.164 so format variants collapse.
 * A null/blank/un-normalizable forwardPhone can never loop.
 */
export function phonesWouldLoop(
  forwardPhone: string | null | undefined,
  forwardedFromPhone: string | null | undefined,
  inboundPhone: string | null | undefined
): boolean {
  const forward = normalizePhone(forwardPhone);
  if (!forward) return false;
  const forwardedFrom = normalizePhone(forwardedFromPhone);
  const inbound = normalizePhone(inboundPhone);
  return forward === forwardedFrom || forward === inbound;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/phoneLoopGuard.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/phoneLoopGuard.ts src/services/phoneLoopGuard.test.ts
git commit -m "feat(backend): phonesWouldLoop call-routing guard"
```

---

### Task 3: Backend — persist + validate `forwarded_from_phone`

**Files:**
- Modify: `src/routes/tenants.ts` (schema line 42-62, GET config SELECT line 163, update-config handler 173-321)
- Test: `src/tenants-update-config-loop.test.ts` (create)

**Interfaces:**
- Consumes: `phonesWouldLoop` (Task 2); `tenants.forwarded_from_phone` (Task 1).
- Produces: `POST /tenants/:id/update-config` accepts + persists `forwarded_from_phone`, returns `400` on a looping `forward_phone`. `GET /tenants/:id/config` returns `forwarded_from_phone`.

- [ ] **Step 1: Add the schema field**

In `src/routes/tenants.ts`, inside `UpdateConfigSchema` (after the `forward_phone` line 59), add:

```ts
  // The line the tenant forwards INTO the assistant. Caller-ID match → collect
  // the caller's real number by voice. Must differ from forward_phone.
  forwarded_from_phone: z.string().max(30).optional().nullable(),
```

- [ ] **Step 2: Add the import**

At the top of `src/routes/tenants.ts`, add:

```ts
import { phonesWouldLoop } from '../services/phoneLoopGuard';
```

- [ ] **Step 3: Add `forwarded_from_phone` to GET config SELECT**

In `GET /tenants/:id/config` (line 163), append `forwarded_from_phone` to the column list:

```ts
          'SELECT tenant_id, name, business_type, system_prompt, voice_id, first_message, team_size, timezone, save_preferences_enabled, preferences_instructions, tts_voice, tts_speed, tts_soft, tts_cheerful, tts_formal, tts_warm, tts_concise, forward_phone, owner_phone, inbound_phone, forwarded_from_phone FROM tenants WHERE tenant_id = $1',
```

- [ ] **Step 4: Extend the prior-fetch type + SELECT (handler line 205-224)**

Add `forwarded_from_phone: string | null;` and `inbound_phone: string | null;` to the `priorRes` generic, and add both columns to the SELECT:

```ts
            forward_phone: string | null;
            owner_phone: string | null;
            forwarded_from_phone: string | null;
            inbound_phone: string | null;
          }>(
            'SELECT business_type, system_prompt, voice_id, first_message, save_preferences_enabled, preferences_instructions, tts_voice, tts_speed, tts_soft, tts_cheerful, tts_formal, tts_warm, tts_concise, forward_phone, owner_phone, forwarded_from_phone, inbound_phone FROM tenants WHERE tenant_id = $1 FOR UPDATE',
```

- [ ] **Step 5: Compute the effective value + loop guard (after line 263, before the UPDATE)**

```ts
          const finalForwardedFromPhone =
            body.forwarded_from_phone !== undefined
              ? body.forwarded_from_phone
              : (prior?.forwarded_from_phone ?? null);

          // Loop guard: a transfer target equal to the forwarded-from line or
          // the AI's own DID would forward the call straight back into the AI.
          if (phonesWouldLoop(finalForwardPhone, finalForwardedFromPhone, prior?.inbound_phone)) {
            await client.query('ROLLBACK');
            return { loop: true as const };
          }
```

- [ ] **Step 6: Persist the column (UPDATE line 265-285)**

Add `forwarded_from_phone = $16` to the SET clause, bump `WHERE tenant_id` to `$17`, and insert `finalForwardedFromPhone` into the params array before `id`:

```ts
          const updRes = await client.query(
            'UPDATE tenants SET system_prompt = $1, voice_id = $2, business_type = $3, first_message = $4, save_preferences_enabled = $5, preferences_instructions = $6, tts_voice = $7, tts_speed = $8, tts_soft = $9, tts_cheerful = $10, tts_formal = $11, tts_warm = $12, tts_concise = $13, forward_phone = $14, owner_phone = $15, forwarded_from_phone = $16 WHERE tenant_id = $17 RETURNING tenant_id',
            [
              finalSystemPrompt,
              finalVoiceId,
              finalBusinessType,
              finalFirstMessage,
              finalSavePreferences,
              finalPreferencesInstructions,
              finalTtsVoice,
              finalTtsSpeed,
              finalTtsSoft,
              finalTtsCheerful,
              finalTtsFormal,
              finalTtsWarm,
              finalTtsConcise,
              finalForwardPhone,
              finalOwnerPhone,
              finalForwardedFromPhone,
              id,
            ]
          );
```

- [ ] **Step 7: Handle the loop sentinel after the transaction (after line 311)**

Immediately after the `withTenantClient(...)` call returns into `result`, before `assertRowAffected`:

```ts
      if ('loop' in result && result.loop) {
        return reply.status(400).send({
          success: false,
          error:
            "The transfer number can't be the same as the forwarded-from number or the assistant's own number — it would loop the call back to the assistant.",
        });
      }
```

> Note: the existing happy-path return value is `{ updRes, businessTypeChanged, cleanedServices, cleanedResources }`. The `'loop' in result` check narrows the union; TypeScript needs the loop branch's return shape `{ loop: true }` to be part of the inferred union, which Step 5's `return { loop: true as const }` provides.

- [ ] **Step 8: Write the route test**

```ts
// src/tenants-update-config-loop.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createMockClient, createMockPool } from './test-utils-mock';

// WHO: owner saving call-routing config. WHAT: the update-config route rejects
// a forward_phone that collides with forwarded_from_phone or inbound_phone.
// WHEN: on POST /tenants/:id/update-config. WHERE: the handler's loop guard.
// WHY: prevents a transfer that loops the live call back into the assistant.

type Route = { path: string; handler: (req: any, reply: any) => Promise<unknown>; opts?: any };
function captureRoutes() {
  const routes: Route[] = [];
  const app: any = {
    get: (path: string, ...a: any[]) => routes.push({ path, handler: a[a.length - 1] }),
    post: (path: string, ...a: any[]) => routes.push({ path, handler: a[a.length - 1] }),
    delete: (path: string, ...a: any[]) => routes.push({ path, handler: a[a.length - 1] }),
  };
  return { app, routes };
}
function reply() {
  const r: any = { statusCode: 200, body: null,
    status(c: number) { r.statusCode = c; return r; },
    send(b: unknown) { r.body = b; return r; } };
  return r;
}

describe('POST /tenants/:id/update-config loop guard', () => {
  let registerTenantRoutes: any;
  const TID = 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0';
  beforeAll(async () => {
    ({ registerTenantRoutes } = await import('./routes/tenants'));
  });

  function setup(priorRow: Record<string, unknown>) {
    const { mockClient: client, queryResponses, queries } = createMockClient();
    const pool = createMockPool(client);
    // BEGIN, prior SELECT (FOR UPDATE), then (no UPDATE on loop) ROLLBACK.
    queryResponses.push({ rows: [] });          // BEGIN
    queryResponses.push({ rows: [priorRow] });  // prior FOR UPDATE
    queryResponses.push({ rows: [] });          // ROLLBACK
    const { app, routes } = captureRoutes();
    // withTenantClient is sourced from the module under test; the mock pool's
    // client is returned by the helper the route builds. registerTenantRoutes
    // takes (app, pool, ...) — pass the mock pool so the handler's
    // withTenantClient(id, fn) runs fn against our scripted client.
    registerTenantRoutes(app, pool);
    return { routes, queries };
  }

  it('SAD: forward_phone == forwarded_from_phone → 400, no UPDATE', async () => {
    const { routes, queries } = setup({
      business_type: 'salon', system_prompt: null, voice_id: null, first_message: null,
      save_preferences_enabled: false, preferences_instructions: null,
      tts_voice: null, tts_speed: null, tts_soft: null, tts_cheerful: null,
      tts_formal: null, tts_warm: null, tts_concise: null,
      forward_phone: null, owner_phone: null,
      forwarded_from_phone: '+16082175303', inbound_phone: '+16308669086',
    });
    const route = routes.find((r) => r.path === '/tenants/:id/update-config')!;
    const req: any = {
      params: { id: TID }, auth: { tenant_id: TID, role: 'owner' },
      body: { forward_phone: '608-217-5303' }, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const rep = reply();
    await route.handler(req, rep);
    expect(rep.statusCode).toBe(400);
    expect(queries.some((q) => /UPDATE tenants SET/.test(q.text))).toBe(false);
  });

  it('SAD: forward_phone == inbound DID → 400', async () => {
    const { routes } = setup({
      business_type: 'salon', system_prompt: null, voice_id: null, first_message: null,
      save_preferences_enabled: false, preferences_instructions: null,
      tts_voice: null, tts_speed: null, tts_soft: null, tts_cheerful: null,
      tts_formal: null, tts_warm: null, tts_concise: null,
      forward_phone: null, owner_phone: null,
      forwarded_from_phone: null, inbound_phone: '+16308669086',
    });
    const route = routes.find((r) => r.path === '/tenants/:id/update-config')!;
    const req: any = {
      params: { id: TID }, auth: { tenant_id: TID, role: 'owner' },
      body: { forward_phone: '+1 630 866 9086' }, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const rep = reply();
    await route.handler(req, rep);
    expect(rep.statusCode).toBe(400);
  });
});
```

- [ ] **Step 9: Run the test (fails until Steps 1-7 land), then the full route file typechecks**

Run: `npx vitest run src/tenants-update-config-loop.test.ts && npx tsc --noEmit`
Expected: 2 tests PASS, tsc clean. (If `registerTenantRoutes`'s signature differs from `(app, pool)`, match it to the real export — check `src/routes/tenants.ts` export + how `index.ts` registers it, and pass the same args.)

- [ ] **Step 10: Commit**

```bash
git add src/routes/tenants.ts src/tenants-update-config-loop.test.ts
git commit -m "feat(backend): persist forwarded_from_phone + loop guard on update-config"
```

---

### Task 4: Agent — plumb `forwarded_from_phone` to the worker

**Files:**
- Modify: `src/routes/agentTools.ts` (tenant-config SELECT line 484 + response line 523)
- Modify: `agent/src/tenantConfig.ts` (type line 60, fallback line 75, raw type line 96, mapping line 111)
- Test: `agent/src/tenantConfig.test.ts` (extend)

**Interfaces:**
- Consumes: `tenants.forwarded_from_phone` (Task 1).
- Produces: `TenantDisplayConfig.forwardedFromPhone: string | null` for Task 5.

- [ ] **Step 1: Backend — add column to the agent tenant-config SELECT + response**

In `src/routes/agentTools.ts`: add `forward_phone: string | null;` is already present — add `forwarded_from_phone: string | null;` to the row generic (near line 482), append `forwarded_from_phone` to the SELECT (line 484), and add to the response object (after line 523):

```ts
        forward_phone: row.forward_phone ?? null,
        // The line the tenant forwards INTO the assistant — caller-ID match
        // tells the agent to collect the caller's real number by voice.
        forwarded_from_phone: row.forwarded_from_phone ?? null,
```

- [ ] **Step 2: Agent — extend the config type + fallback + mapping**

In `agent/src/tenantConfig.ts`:

After line 60 (`forwardPhone: string | null;`):
```ts
  /**
   * E.164 line the tenant forwards INTO the assistant. When the SIP caller-ID
   * matches this, the agent treats the caller-ID as the forwarding line (not the
   * customer) and collects the caller's real number verbally. NULL = no
   * forwarded-line handling via this field (env list still applies). 2026-06-29.
   */
  forwardedFromPhone: string | null;
```

In `TENANT_FALLBACK` after line 75 (`forwardPhone: null,`):
```ts
  forwardedFromPhone: null,
```

In the raw response type after line 96 (`forward_phone?: string | null;`):
```ts
    forwarded_from_phone?: string | null;
```

In the mapping after line 111 (`forwardPhone: res.result.forward_phone ?? null,`):
```ts
      forwardedFromPhone: res.result.forwarded_from_phone ?? null,
```

- [ ] **Step 3: Extend the agent test**

In `agent/src/tenantConfig.test.ts`, add to the "maps every column" success test a `forwarded_from_phone` in the scripted response and assert the mapping. Add a focused case:

```ts
  // WHO: forwarded-line tenant. WHAT: fetchTenantConfig surfaces the new
  // forwarded_from_phone as camelCase forwardedFromPhone. WHEN: per-call config
  // fetch. WHERE: agent/src/tenantConfig.ts mapping. WHY: index.ts keys the
  // forwarded-line caller-ID match off this field.
  it('maps forwarded_from_phone → forwardedFromPhone', async () => {
    const client = makeClient({
      ok: true,
      result: { name: 'X', timezone: 'America/Chicago', system_prompt: null,
        forward_phone: '+16305551234', forwarded_from_phone: '+16082175303' },
    });
    const cfg = await fetchTenantConfig(client, TENANT_ID);
    expect(cfg.forwardedFromPhone).toBe('+16082175303');
    expect(cfg.forwardPhone).toBe('+16305551234');
  });
```

> Use whatever client-mock helper the existing tests use (check the top of `agent/src/tenantConfig.test.ts` — replicate its `makeClient`/stub pattern exactly; the snippet above assumes a `makeClient({ ok, result })` shape — adapt to the real one).

- [ ] **Step 4: Run agent tests + typecheck**

Run: `cd agent && npx vitest run src/tenantConfig.test.ts && npx tsc --noEmit && cd ..`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/routes/agentTools.ts agent/src/tenantConfig.ts agent/src/tenantConfig.test.ts
git commit -m "feat(agent): plumb forwarded_from_phone into tenant config"
```

---

### Task 5: Agent — repoint forwarded-line match to `forwardedFromPhone`

**Files:**
- Modify: `agent/src/index.ts:460`

**Interfaces:**
- Consumes: `tenantConfig.forwardedFromPhone` (Task 4).

- [ ] **Step 1: Repoint the caller-ID match**

In `agent/src/index.ts`, change line 460 from:
```ts
      if (callerIdIsForwardNumber(sessionCtx.callerPhone, tenantConfig.forwardPhone)) {
```
to:
```ts
      if (callerIdIsForwardNumber(sessionCtx.callerPhone, tenantConfig.forwardedFromPhone)) {
```

Update the preceding comment block (lines 452-459) to drop the "Requires the tenant's forward_phone" / "Known v1 gap" wording — the gap is now resolved; it keys off `forwarded_from_phone`, which is independent of the transfer target.

- [ ] **Step 2: Typecheck the agent**

Run: `cd agent && npx tsc --noEmit && cd ..`
Expected: clean (the field exists from Task 4).

- [ ] **Step 3: Full agent test suite (no regressions)**

Run: `cd agent && npx vitest run && cd ..`
Expected: all PASS (the unchanged `callerIdIsForwardNumber` tests still green; the wiring now reads the new field).

- [ ] **Step 4: Commit**

```bash
git add agent/src/index.ts
git commit -m "fix(agent): key forwarded-line match off forwarded_from_phone, not forward_phone"
```

---

### Task 6: Dashboard — second phone field + client-side loop guard

**Files:**
- Modify: `dashboard/lib/types.ts` (Tenant/config interfaces — lines ~79 + ~186)
- Modify: `dashboard/components/AIConfigView.tsx` (save 83-102, render after 246)
- Test: `dashboard/components/AIConfigView.test.tsx` (extend)

**Interfaces:**
- Consumes: `forwarded_from_phone` from `GET /tenants/:id/config` (Task 3); `phonesWouldLoop` logic mirrored client-side.

- [ ] **Step 1: Add `forwarded_from_phone` to the types**

In `dashboard/lib/types.ts`, add `forwarded_from_phone?: string | null;` next to `forward_phone?` in BOTH interfaces that carry `forward_phone` (line ~79 and the second block ~186):

```ts
  forward_phone?: string | null;
  forwarded_from_phone?: string | null;
```

- [ ] **Step 2: Send `forwarded_from_phone` in the save payload**

In `dashboard/components/AIConfigView.tsx`, in the `updateConfig` object (after the `forward_phone` line 99):

```ts
        forward_phone: normalizePhone(config.forward_phone),
        // The line the tenant forwards INTO the assistant.
        forwarded_from_phone: normalizePhone(config.forwarded_from_phone),
```

- [ ] **Step 3: Add the field + client-side loop check (render, after line 246)**

Insert a new section BEFORE the "Forward Calls to a Person" section (it's the inbound number, logically first), and compute a loop flag for inline error:

```tsx
        {/* Forwarded-from number — the line that forwards calls INTO the AI. */}
        <section className="space-y-4">
          <h2
            className="text-lg font-bold flex items-center"
            style={{ color: 'var(--text-primary)' }}
          >
            <PhoneForwarded className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
            Forwarded-From Number
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            If you forward your business line into the assistant, put that line here. The assistant
            then knows the caller ID is your forwarding line — not the customer — and will ask the
            caller for their name and number instead.
          </p>
          <Input
            type="tel"
            label="Forwarded-from number"
            value={config?.forwarded_from_phone || ''}
            onChange={(e) => {
              setConfig((prev) => (prev ? { ...prev, forwarded_from_phone: e.target.value } : null));
              setDirty(true);
            }}
            placeholder="Ex: +1 608 217 5303"
          />
        </section>
```

Then in the existing "Forward Calls to a Person" section, add an inline error under the input when it collides. First, near the top of the component body (with the other derived values), add:

```tsx
  const forwardLoops =
    !!normalizePhone(config?.forward_phone) &&
    (normalizePhone(config?.forward_phone) === normalizePhone(config?.forwarded_from_phone) ||
      normalizePhone(config?.forward_phone) === normalizePhone(config?.inbound_phone));
```

Under the `forward_phone` `<Input>` (after line 245), add:

```tsx
          {forwardLoops && (
            <p className="text-sm" style={{ color: 'var(--danger, #dc2626)' }}>
              This can&apos;t be the same as your forwarded-from number or the assistant&apos;s own
              number — the call would loop back to the assistant.
            </p>
          )}
```

- [ ] **Step 4: Block Save when it loops**

Find the Save button in `AIConfigView.tsx` (the one driven by `saving`/`dirty`) and add `forwardLoops` to its `disabled`:

```tsx
            disabled={saving || !dirty || forwardLoops}
```

(If the button uses only `isLoading={saving}`, add `disabled={forwardLoops}` alongside it.)

- [ ] **Step 5: Extend the component test**

In `dashboard/components/AIConfigView.test.tsx`, add:

```tsx
  // WHO: owner. WHAT: entering a transfer number equal to the forwarded-from
  // number shows an inline loop error and disables Save. WHERE: AIConfigView.
  // WHY: client mirror of the backend loop guard for instant feedback.
  it('shows a loop error + disables Save when forward == forwarded-from', async () => {
    // render with a config preset where both numbers normalize equal, then
    // assert the error copy is present and the Save button is disabled.
    // (Follow the existing render/setup helper in this file for providing
    // SessionContext + a loaded config; set forwarded_from_phone and
    // forward_phone to the same number.)
  });
```

> Replace the comment body with the file's actual render harness (it already mounts `AIConfigView` with a mocked `Api.tenants.getConfig`). Assert: `screen.getByText(/loop back to the assistant/i)` present and the Save button has the `disabled` attribute.

- [ ] **Step 6: Run dashboard typecheck + tests**

Run: `cd dashboard && npx tsc --noEmit && npm test -- AIConfigView && cd ..`
Expected: tsc clean, AIConfigView tests PASS.

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib/types.ts dashboard/components/AIConfigView.tsx dashboard/components/AIConfigView.test.tsx
git commit -m "feat(dashboard): forwarded-from number field + client loop guard"
```

---

### Task 7: Full verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Backend gates**

Run: `npm run checks && npm test`
Expected: format + lint + tsc clean; all backend tests pass (incl. `phoneLoopGuard`, `tenants-update-config-loop`).

- [ ] **Step 2: Agent gates**

Run: `cd agent && npx tsc --noEmit && npx vitest run && cd ..`
Expected: clean + green.

- [ ] **Step 3: Dashboard gates**

Run: `cd dashboard && npx tsc --noEmit && npm test && cd ..`
Expected: clean + green.

- [ ] **Step 4: Rebuild-from-scratch DB check (migration chain replays clean)**

Run: `npm run db:rebuild -- --yes`
Expected: DROP SCHEMA + apply all migrations (incl. `20260629000000`) + seed, no error.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/forwarded-from-number
gh pr create --base main --head feat/forwarded-from-number \
  --title "feat: separate forwarded-from vs transfer-to number (+ loop guard)" \
  --body "Implements docs/superpowers/specs/2026-06-29-forwarded-from-vs-transfer-number-design.md. Splits the overloaded forward_phone into forwarded_from_phone (inbound caller-ID match) + forward_phone (transfer target), with a save-time loop guard. Migration adds a nullable column (forward-compatible). Apply 20260629000000 to prod BEFORE merge per the merge-before-migrate rule."
```

- [ ] **Step 6: Apply migration to prod before merge, then merge after green CI**

Apply `20260629000000` to the prod DB (per the merge-before-migrate rule — the column read degrades to NULL if absent, but apply first to be safe), wait for the 4 CI jobs green, then squash-merge + delete branch.

---

## Notes for the implementer

- **Back-compat:** `UNTRUSTED_CALLER_ID_TENANTS` env guard in `agent/src/index.ts:164` is UNCHANGED — it still nulls caller-ID for listed tenants. The number-match guard (Task 5) is the precise complement. Tenants with neither set behave exactly as today.
- **`transfer_call` is untouched** — it still reads `forward_phone` as the transfer destination.
- **Deploy safety:** all reads use `?? null`; merging before the migration applies is safe (column reads as NULL → no forwarded-line match via the new field, env list still works).
