/**
 * hooks.ts — unmount-safety tests for the fetch-on-mount data hooks.
 *
 * Both useEntityList (backing useCustomers/useResources/useEmployees/
 * useServices/useSkills) and useServiceMappings kick off a fetch from an
 * effect with no cancellation. If the component unmounts while that fetch is
 * still in flight, the `.then` continuation lands on a dead tree.
 *
 * In the browser that is a benign React warning. Under vitest+jsdom the test
 * environment is torn down with the component, so React's
 * `getCurrentEventPriority` reads a `window` that no longer exists and throws
 * `ReferenceError: window is not defined` as an UNHANDLED REJECTION — which
 * fails the entire vitest run with a nonzero exit while still reporting
 * "1012 passed". That is exactly how it presented on 2026-07-09: green tests,
 * red `npm run prepare-commit`, and only under full-suite load (the race needs
 * a slow enough fetch that teardown wins).
 *
 * These tests resolve the fetch AFTER unmount on purpose, so a regression
 * reintroduces the unhandled rejection here rather than randomly in whichever
 * unrelated spec file happens to be running when the race lands.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    customers: { list: vi.fn() },
    mappings: { listServiceEmployee: vi.fn(), listServiceResource: vi.fn() },
  },
}));

vi.mock('./api', () => ({ Api: mockApi }));
vi.mock('@/lib/SessionContext', () => ({
  useActiveTenantId: () => 'tenant-under-test',
}));

import { useCustomers, useServiceMappings } from './hooks';

/** A promise we control: resolve it whenever the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Fail the test on any unhandled rejection, which is the failure mode under
 * test. Vitest reports these as run-level "Errors" rather than attributing
 * them to a test, so we capture them ourselves.
 */
let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
  mockApi.customers.list.mockReset();
  mockApi.mappings.listServiceEmployee.mockReset();
  mockApi.mappings.listServiceResource.mockReset();
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
});

/** Let any queued microtasks (the awaited continuations) actually run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * Run `fn` with `globalThis.window` removed, then put it back.
 *
 * This is what makes these tests bite. A plain setState-after-unmount is a
 * silent no-op while `window` still exists, so unmount+resolve alone passes
 * with OR without the fix. The real failure needs the jsdom environment to be
 * gone when the continuation runs — React's dispatchSetState → requestUpdateLane
 * → getCurrentEventPriority reads `window` unconditionally and throws. Deleting
 * `window` reproduces vitest's end-of-file teardown deterministically, in-file,
 * instead of waiting for the cross-file race to happen to land.
 *
 * Verified 2026-07-09: with the mounted guards removed, each SAD test below
 * captures `ReferenceError: window is not defined`; with them, zero.
 */
async function withWindowTornDown(fn: () => void) {
  const realWindow = globalThis.window;
  // @ts-expect-error deliberately simulating environment teardown
  delete globalThis.window;
  try {
    fn();
    await flush();
  } finally {
    globalThis.window = realWindow;
  }
}

describe('useEntityList — unmount during in-flight fetch', () => {
  test('SAD: fetch resolving after unmount does not setState or reject', async () => {
    // WHO: any view using useCustomers that the owner navigates away from
    // WHAT: unmount first, THEN resolve the fetch → no setState on a dead tree
    // WHEN: slow API + fast tab switch (or, in CI, jsdom teardown winning the race)
    // WHERE: hooks.ts useEntityList refresh() — the mounted.current guards
    // WHY: without the guard React calls getCurrentEventPriority, touches the
    //      torn-down `window`, and throws an unhandled rejection that fails the
    //      whole run. Pin it: unmount, resolve, expect silence.
    const d = deferred<unknown[]>();
    mockApi.customers.list.mockReturnValue(d.promise);

    const { unmount } = renderHook(() => useCustomers());
    // The effect has fired and is parked on the await.
    await waitFor(() => expect(mockApi.customers.list).toHaveBeenCalledTimes(1));

    unmount();
    // Resolve after the component AND the environment are gone.
    await withWindowTornDown(() => d.resolve([{ customer_id: 'c1' }]));

    expect(unhandled).toEqual([]);
  });

  test('SAD: fetch REJECTING after unmount is swallowed, not re-thrown', async () => {
    // WHO: same view, but the API call fails while the user navigates away
    // WHAT: the catch branch must also respect the mounted guard
    // WHEN: network error races unmount
    // WHERE: hooks.ts useEntityList catch → setData([])
    // WHY: an early `return` in catch must still leave `finally` safe; a
    //      setLoading(false) there would hit the same dead-tree crash.
    const d = deferred<unknown[]>();
    mockApi.customers.list.mockReturnValue(d.promise);

    const { unmount } = renderHook(() => useCustomers());
    await waitFor(() => expect(mockApi.customers.list).toHaveBeenCalledTimes(1));

    unmount();
    await withWindowTornDown(() => d.reject(new Error('network down')));

    expect(unhandled).toEqual([]);
  });

  test('HAPPY: fetch resolving while still mounted populates data', async () => {
    // WHO: the ordinary case — component stays mounted
    // WHAT: guard must not suppress legitimate state updates
    // WHEN: normal page load
    // WHERE: hooks.ts useEntityList success path
    // WHY: a guard that always returned early would silently break every list
    //      view while making the unmount tests pass. Prove data still lands.
    mockApi.customers.list.mockResolvedValue([{ customer_id: 'c1' }]);

    const { result } = renderHook(() => useCustomers());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([{ customer_id: 'c1' }]);
    expect(unhandled).toEqual([]);
  });
});

describe('useServiceMappings — unmount during in-flight fetch', () => {
  test('SAD: both mapping fetches resolving after unmount stay silent', async () => {
    // WHO: SchedulerView, which is what actually tripped this in CI
    // WHAT: Promise.allSettled resolves post-unmount → guarded, no setState
    // WHEN: scheduler.test.tsx teardown raced the mappings fetch (2026-07-09)
    // WHERE: hooks.ts useServiceMappings refresh() — the trace named line 194,
    //        the `setLoading(false)` in its finally block
    // WHY: this is the exact stack that made vitest exit 1 with 0 failing tests.
    const se = deferred<unknown[]>();
    const sr = deferred<unknown[]>();
    mockApi.mappings.listServiceEmployee.mockReturnValue(se.promise);
    mockApi.mappings.listServiceResource.mockReturnValue(sr.promise);

    const { unmount } = renderHook(() => useServiceMappings());
    await waitFor(() => expect(mockApi.mappings.listServiceEmployee).toHaveBeenCalledTimes(1));

    unmount();
    await withWindowTornDown(() => {
      se.resolve([]);
      sr.resolve([]);
    });

    expect(unhandled).toEqual([]);
  });

  test('HAPPY: mappings resolving while mounted still build the maps', async () => {
    // WHO: scheduler with real service→employee mappings
    // WHAT: guard does not block the mounted success path
    // WHEN: normal scheduler load
    // WHERE: hooks.ts useServiceMappings → buildMappingMaps
    // WHY: same reason as above — prove the guard is a race fix, not a mute button.
    mockApi.mappings.listServiceEmployee.mockResolvedValue([
      { service_id: 's1', employee_id: 'e1' },
    ]);
    mockApi.mappings.listServiceResource.mockResolvedValue([]);

    const { result } = renderHook(() => useServiceMappings());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.maps.serviceEmployee.get('s1')).toEqual(new Set(['e1']));
    expect(unhandled).toEqual([]);
  });
});
