# TODO__ISSUES_TO_FIX

## Summary from /mnt/c/Users/Dale/fix/issues.txt

Pre-push failed on unit tests (18 failures). Quality checks passed but `vitest run` failed. Main blockers: test DB seeding + multi-tenant queries.

## TODO List

### 1. Fix coverage.test.ts (6 failures) + coverage-ui-consistency.test.ts (7 failures)

- All fail on `insert into services ... violates foreign key constraint "services_tenant_id_fkey"`
- Tests cover gap detection, full/partial status, is_off=true, soft-delete employees, UI consistency mapping.
- Solution: Test DB bootstrap missing tenant row before service seed. Update seedService() or use test-db canonical setup with proper tenant insert first. Align with recent fix/test-db-bootstrap changes.

### 2. Fix tests/regression/multi-tenant-isolation.test.ts (5 failures)

- DELETE /resources/:b-id/delete under A JWT: TypeError reading 'is_deleted' of undefined.
- Positive controls (GET /customers with A/B tenant overrides, super-admin) fail to find expected customer rows (undefined).
- Solution: Recent RLS or route changes to resources/customers broke test assertions. Check query filters, soft-delete handling, tenant context in GET handlers. Update expectations or fix isolation bug.

### 3. Address repeated "relation \"tenants\" does not exist" errors

- Seen in reminders.test.ts, communications.test.ts during withTenantClient().
- Tests marked SAD/HAPPY for best-effort behavior but pollute logs.
- Solution: Ensure test tenants created in setup or mock tenant lookup. Prune or fix test isolation per backlog-doc-hygiene.

### 4. Cleanup warnings (non-blocking)

- Vite config ESM/CommonJS warning in vitest.config.ts.
- pg DeprecationWarning on client.query() in multiple tests.
- ai_cost_model_unpriced logs.
- Solution: Add .mjs or "type": "module", update queries to async/await, suppress known test logs.

Run `npm run test` after fixes. Verify all 3029 tests green before push.
