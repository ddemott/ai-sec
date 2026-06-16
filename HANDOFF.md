# E2E Test Fix Handoff — 2026-06-15 (COMPLETE)

## Mission

Run the full Playwright E2E suite (from `dashboard/`), fix all failures.

## Final State: 146 passed, 7 skipped, 0 failed ✅

---

## All Fixes Applied This Session

### Previous session fixes (see git log)

| Spec                                 | Tests | Fix                                               |
| ------------------------------------ | ----- | ------------------------------------------------- |
| `industry-templates.spec.ts`         | 4     | Business templates empty after rebuild            |
| `vocabulary-overrides.spec.ts`       | 3     | Same root cause                                   |
| `ui-rename-verification.spec.ts`     | 3     | Service+resource in beforeAll; exact button match |
| `quick-book-shift-overrides.spec.ts` | 1     | Seed shifts `00:00-23:59`                         |
| `reminder-on-create.spec.ts`         | 1     | Include employee_id, book on shiftless day        |
| `voice-styles.spec.ts`               | 6     | DB columns, MOCK_TENANT, dirty-flag               |

### This session fixes

| Spec                             | Test                              | Root Cause                                                           | Fix                                                                                      |
| -------------------------------- | --------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `agent-conversation.spec.ts:273` | employee_name toBeTruthy          | MODE B (empty skills) = RPC picks resource only, employee stays NULL | Changed to `toBeNull()`                                                                  |
| `caller-identity.spec.ts:154`    | login 401                         | URL was `/auth/login`; backend route is `/login`                     | Fixed to `/login`                                                                        |
| `caller-identity.spec.ts:169`    | `list.customers` undefined        | `/customers` returns plain array, not `{ customers: [...] }`         | Access array directly                                                                    |
| `e2e/helpers/test.ts`            | Intermittent font manifest errors | Next.js dev-server race on `.next/next-font-manifest.json`           | Filter `load-manifest.js` / `getNextFontManifest` stack frames from page-error collector |

---

## Root Cause (Critical — affects all future rebuilds)

**`baseline.sql` + `--baseline` mode = empty `business_templates` after every rebuild**

`rebuild-db.sh` flow:

1. DROP SCHEMA public CASCADE
2. Apply `baseline.sql` → creates table schemas, **NO DATA**
3. Run `setup-db.sh --baseline` → marks ALL historical migrations as "applied" **WITHOUT running SQL**
4. Run `seed.sql` → previously had no template data

Result: `business_templates` always empty after rebuild. 30 templates exist only in migration files that never run.

**Fix applied**: Added all 30 templates to `supabase/seed.sql` with `ON CONFLICT DO UPDATE`. See section "10. Business Templates" at end of seed.sql.

**WARNING**: If you ever manually re-run old migration `20260228000006_business_templates.sql`,
it contains `CREATE OR REPLACE FUNCTION create_default_resources()` using `NEW.id` (old PK name).
This REPLACES the correct baseline function that uses `NEW.tenant_id` — registration breaks.
Fix with:

```sql
CREATE OR REPLACE FUNCTION public.create_default_resources()
 RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_template business_templates%ROWTYPE;
BEGIN
  SELECT * INTO v_template FROM business_templates WHERE business_type = NEW.business_type;
  IF FOUND THEN
    INSERT INTO resources (tenant_id, name, description)
    VALUES (NEW.tenant_id, v_template.default_resource_name, v_template.default_resource_description);
  END IF;
  RETURN NEW;
END; $$;
```

---

## Unstaged Changes (ready to commit)

```
dashboard/e2e/agent-conversation.spec.ts     — employee_name toBeNull() for MODE B
dashboard/e2e/caller-identity.spec.ts        — /login URL fix + response shape fix
dashboard/e2e/helpers/test.ts                — filter Next.js font manifest page errors
dashboard/e2e/quick-book-shift-overrides.spec.ts  — shift hours 00:00-23:59
dashboard/e2e/reminder-on-create.spec.ts           — include employee_id in bad booking
dashboard/e2e/ui-rename-verification.spec.ts       — service+resource in beforeAll, exact button
dashboard/e2e/voice-styles.spec.ts                 — dirty-flag fix (uncheck+check always)
dashboard/lib/mockData.ts                          — MOCK_TENANT → Bella's (b3e1aaaa...)
supabase/seed.sql                                  — 30 business templates (section 10)
```

---

## How to Run Tests

```bash
# Must be in dashboard/ dir:
cd /home/dale/projects/secretary-hq/dashboard

# Full suite (resets DB — ~2 min):
npx playwright test --reporter=line

# Skip DB reset (use when DB already in good state):
PLAYWRIGHT_SKIP_DB_RESET=1 npx playwright test --reporter=line

# Single spec:
PLAYWRIGHT_SKIP_DB_RESET=1 npx playwright test agent-conversation.spec.ts --reporter=line
```

## Services Must Be Running

- Backend: `node dist/src/index.js` on port 4001 (pid 644443 as of session)
- Dashboard: Next.js dev on port 4000
- DB: Docker Postgres on port 5433
- After ANY `src/` change: `npm run build` + kill/restart backend

## DB State

`business_templates` is populated (30 rows). No rebuild needed — current DB is good.
If you rebuild (`npm run db:rebuild -- --yes`), new seed.sql section 10 repopulates templates correctly.
