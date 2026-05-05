/**
 * Shared test helpers for dashboard component tests that mock `fetch`.
 *
 * Before this module landed, two test files (superadmin.test.tsx,
 * settings.test.tsx) cast partial Response literals to `any` ~20 times to
 * satisfy the `Response` shape that production code reads (`.ok`, `.status`,
 * `.json()`). This helper centralizes the cast so call sites can drop the
 * `as any` and stay readable.
 *
 * For real-DB integration tests, use `src/test-utils.ts` (backend) instead;
 * for backend mock-pg-client tests, use `src/test-utils-mock.ts`. This module
 * is only for dashboard tests that mock the global `fetch`.
 */

/**
 * Build a mock `Response` carrying the given JSON body. Intended for the
 * inside of a `vi.fn(async (input, init) => { ... })` fetch implementation,
 * so the `as Response` cast is contained here rather than at every call site.
 *
 * @param body  Value the consumer's `await res.json()` should resolve to.
 * @param init  Optional `ok` and/or `status` overrides (defaults: 200 / true).
 */
export function mockJsonResponse<T>(
  body: T,
  init?: { ok?: boolean; status?: number },
): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body as unknown,
  } as Response;
}
