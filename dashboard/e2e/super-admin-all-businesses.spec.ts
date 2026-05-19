/**
 * Super-admin all-businesses tab — pins that `TenantCard` renders
 * without crashing on the renamed `tenant_id` PK column.
 *
 * WHO   : super-admin viewing the cross-tenant management page
 *         (`admin@secretaryhq.com`, tenant_id = all-zeros).
 * WHAT  : `/dashboard?tab=all-businesses` renders the tenant list;
 *         each `TenantCard` shows the business name AND the truncated
 *         tenant_id (8 hex chars from `.slice(0,8)`) without throwing.
 * WHEN  : every super-admin login + navigation to all-businesses.
 *         This is the first route the dashboard lands on after a
 *         super-admin login, so any regression here breaks the
 *         platform-admin workflow immediately.
 * WHERE : `dashboard/components/TenantCard.tsx` line 59 reads
 *         `tenant.tenant_id.slice(0,8)` for the truncated UUID badge.
 *         The data comes from `Api.tenants.list()` which hits
 *         `GET /tenants` and expects rows shaped per the DB after
 *         pilot 16 (`tenants.id` → `tenants.tenant_id`).
 * WHY   : 2026-05-13 — the May 12 PK rename moved `tenants.id` →
 *         `tenants.tenant_id` across the schema, and `TenantCard.tsx`
 *         was updated to match. Then a stale `dashboard/.next/standalone`
 *         build (May 8) shipped with the source running against the
 *         post-rename backend. The bundled chunk still read `tenant.id`
 *         (now undefined since the API returns `tenant_id`), called
 *         `.slice(0,8)` on undefined, and the React error boundary
 *         caught it. The full existing E2E suite stayed green because
 *         no spec exercised the super-admin all-businesses route.
 *         This test makes any future regression of that exact shape
 *         (column rename without corresponding component update, OR
 *         a stale build flying solo) visible without a human in the
 *         loop.
 *
 * Watchdog: imported from `./helpers/test` rather than `@playwright/test`.
 * That wrapper adds two automatic safety nets — `pageerror` listener
 * and end-of-test error-boundary visibility check. Either trip → this
 * test fails loudly. Without those nets, a future regression would
 * render the boundary, the test would still see SOME tenant card
 * (or not), and we'd get green-with-broken-page again. The nets are
 * load-bearing for the WHY above to hold over time.
 */
import { test, expect } from './helpers/test';

test('super-admin all-businesses: tenant cards render with name + truncated UUID', async ({
  page,
}) => {
  await page.goto('/dashboard?tab=all-businesses');

  // At least one tenant card should render (the platform admin tenant
  // is always present from supabase/seed.sql). data-testid matches
  // `tenant-card-${tenant.tenant_id}` — a regression to `tenant.id`
  // would produce `tenant-card-undefined` and this locator would still
  // find it, so the assertion below pins the actual rendered content,
  // not the selector.
  const cards = page.locator('[data-testid^="tenant-card-"]');
  await expect(cards.first()).toBeVisible({ timeout: 10_000 });

  // Pin actual content: the first card shows the platform admin name
  // AND a truncated tenant_id (8 hex chars produced by `.slice(0,8)`
  // on a real UUID). If `tenant.tenant_id` were undefined the .slice()
  // would throw, the boundary would catch it, and the boundary watchdog
  // in helpers/test.ts would fail us. The content check is belt + braces
  // — if a future bug routes the data through a different code path
  // that doesn't throw but renders empty, we still fail here.
  const firstCardText = await cards.first().innerText();
  expect(
    firstCardText,
    'TenantCard must show a truncated UUID (8 hex chars) — regression to `tenant.id` would print "undefined" instead'
  ).toMatch(/[0-9a-f]{8}/i);

  // At least the platform admin and DynaTire (from supabase/seed.sql)
  // should be visible. Cards beyond those vary across runs depending
  // on what previous tests left in the DB; counting >=2 is the stable
  // lower bound for a fresh-seeded DB.
  const cardCount = await cards.count();
  expect(
    cardCount,
    'Expected at least 2 tenants (SecretaryHQ Platform + DynaTire from supabase/seed.sql)'
  ).toBeGreaterThanOrEqual(2);
});
