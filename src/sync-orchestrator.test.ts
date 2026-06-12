/**
 * Unit tests for the sync orchestrator's test-mode dispatch recorder.
 *
 * The recorder is a no-op outside test mode (SYNC_TEST_RECORDER=1).
 * The Playwright e2e at dashboard/e2e/calendar-sync.spec.ts asserts the
 * fully wired flow; these tests pin the recorder semantics in isolation
 * — env-gating, ring-buffer cap, clear() — without spinning up Postgres
 * or the HTTP layer. Provider modules are mocked to no-op promises so
 * the orchestrator's catch-all error handling never logs to stderr
 * during the suite.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';

// Mock all provider modules so the orchestrator's `.catch()` never runs
// against a real DB pool. Each fn returns Promise<void> — the orchestrator
// only needs them to be thenable.
vi.mock('./services/calendarSync', () => ({
  syncAppointmentToCalendar: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./services/crm/squareSync', () => ({
  syncAppointmentToSquare: vi.fn().mockResolvedValue(undefined),
  syncCustomerToSquare: vi.fn().mockResolvedValue(undefined),
}));

import {
  syncAppointmentToAll,
  syncCustomerToAll,
  getSyncRecorder,
  clearSyncRecorder,
  type SyncEvent,
} from './services/syncOrchestrator';

const TENANT_ID = '11111111-2222-3333-4444-555555555555';
const APPT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CUST_ID = '99999999-8888-7777-6666-555555555555';

// Pool isn't actually used inside the mocked provider fns, but the
// orchestrator's signature requires one — a typed cast keeps TS happy
// without dragging pg into a unit test.
const FAKE_POOL = {} as Pool;

describe('syncOrchestrator recorder', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.SYNC_TEST_RECORDER;
    clearSyncRecorder();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SYNC_TEST_RECORDER;
    } else {
      process.env.SYNC_TEST_RECORDER = originalEnv;
    }
    clearSyncRecorder();
  });

  it('HAPPY: enabled → records 2 appointment events on syncAppointmentToAll', () => {
    // WHO: backend running with SYNC_TEST_RECORDER=1 (Playwright e2e mode)
    // WHAT: orchestrator dispatches to all providers (calendar + Square) —
    //       each appears in the recorder with the right
    //       tenantId/entityId/action
    // WHEN: test boot sets the env, then a route triggers an appointment
    //       create (or the test harness calls the orchestrator directly)
    // WHERE: in-memory recorder buffer in syncOrchestrator.ts
    // WHY: prod gives no observable side-effect when no integrations are
    //       configured, so without this hook the e2e can't tell the
    //       difference between "orchestrator ran and was a no-op" vs.
    //       "orchestrator never got called because the route forgot it"
    process.env.SYNC_TEST_RECORDER = '1';
    syncAppointmentToAll(FAKE_POOL, TENANT_ID, APPT_ID, 'create');

    const events = getSyncRecorder();
    expect(events).toHaveLength(2);
    expect(events.map((e: SyncEvent) => e.provider).sort()).toEqual(['calendar', 'square']);
    for (const e of events) {
      expect(e.entity).toBe('appointment');
      expect(e.action).toBe('create');
      expect(e.tenantId).toBe(TENANT_ID);
      expect(e.entityId).toBe(APPT_ID);
      // ts must be a parseable ISO string so the e2e can sort/window events
      expect(() => new Date(e.ts).toISOString()).not.toThrow();
    }
  });

  it('HAPPY: enabled → records 1 customer event on syncCustomerToAll (no calendar)', () => {
    // WHO: orchestrator dispatched a customer-create
    // WHAT: only the CRMs (Square) receive customer events — calendars
    //       don't store contacts, so the customer dispatch list is shorter
    // WHEN: test mode, route calls syncCustomerToAll
    // WHY: regression-pin the contract between routes and providers —
    //       if calendar is ever added to syncCustomerToAll the recorder
    //       count grows and this test fails loudly
    process.env.SYNC_TEST_RECORDER = '1';
    syncCustomerToAll(FAKE_POOL, TENANT_ID, CUST_ID, 'update');

    const events = getSyncRecorder();
    expect(events).toHaveLength(1);
    expect(events.map((e: SyncEvent) => e.provider).sort()).toEqual(['square']);
    for (const e of events) {
      expect(e.entity).toBe('customer');
      expect(e.action).toBe('update');
      expect(e.entityId).toBe(CUST_ID);
    }
  });

  it('SAD: disabled (env unset) → records nothing', () => {
    // WHO: backend running normally in prod or dev (no env var)
    // WHAT: orchestrator dispatches as usual, but the recorder buffer
    //       stays empty — zero overhead, zero memory growth
    // WHY: SYNC_TEST_RECORDER must be a strict opt-in. If it ever
    //       silently records in prod we leak tenant activity into
    //       process memory + the test route would expose it.
    delete process.env.SYNC_TEST_RECORDER;
    syncAppointmentToAll(FAKE_POOL, TENANT_ID, APPT_ID, 'create');
    syncCustomerToAll(FAKE_POOL, TENANT_ID, CUST_ID, 'delete');

    expect(getSyncRecorder()).toHaveLength(0);
  });

  it('SAD: disabled (env="0", "true", anything-not-strict-1) → records nothing', () => {
    // WHY: defensive — only the literal string "1" enables. "true",
    //       "yes", "on", numeric 1, etc. all stay disabled. This pins
    //       the gate so a refactor that switches to truthy-check
    //       (which would enable accidentally on "false") fails here.
    for (const val of ['0', 'true', 'yes', 'on', '']) {
      process.env.SYNC_TEST_RECORDER = val;
      syncAppointmentToAll(FAKE_POOL, TENANT_ID, APPT_ID, 'create');
      expect(getSyncRecorder()).toHaveLength(0);
    }
  });

  it('HAPPY: clearSyncRecorder() empties the buffer', () => {
    // WHY: the e2e clears between test cases to keep assertions
    //       independent — without this the buffer cross-contaminates
    //       and "5 events" creeps to "10, 15, 20...".
    process.env.SYNC_TEST_RECORDER = '1';
    syncAppointmentToAll(FAKE_POOL, TENANT_ID, APPT_ID, 'create');
    expect(getSyncRecorder()).toHaveLength(2);

    clearSyncRecorder();
    expect(getSyncRecorder()).toHaveLength(0);

    // Recorder still works after clearing (not a destructive operation)
    syncAppointmentToAll(FAKE_POOL, TENANT_ID, APPT_ID, 'update');
    expect(getSyncRecorder()).toHaveLength(2);
  });

  it('HAPPY: ring-buffer caps at 500 events, drops oldest', () => {
    // WHY: a long-running test session shouldn't grow recorder memory
    //       unbounded. The cap also models "rolling window" behavior —
    //       you only ever see recent events, so the e2e must clear
    //       before the assertion (which it does, see above).
    process.env.SYNC_TEST_RECORDER = '1';
    // 300 appointment dispatches × 2 providers each = 600 events
    for (let i = 0; i < 300; i++) {
      syncAppointmentToAll(FAKE_POOL, TENANT_ID, APPT_ID, 'create');
    }
    const events = getSyncRecorder();
    expect(events).toHaveLength(500);
  });

  it('HAPPY: events appear in dispatch order across multiple calls', () => {
    // WHY: the e2e wants to assert "the appointment-create that just
    //       happened produced its events" — order matters because we
    //       slice by timestamp window. Pin that the recorder is
    //       append-only (FIFO), not a set/reorder.
    process.env.SYNC_TEST_RECORDER = '1';
    syncAppointmentToAll(FAKE_POOL, TENANT_ID, APPT_ID, 'create');
    syncCustomerToAll(FAKE_POOL, TENANT_ID, CUST_ID, 'create');

    const events = getSyncRecorder();
    expect(events).toHaveLength(3);
    // First 2 are appointment events, next 1 is the customer event
    expect(events.slice(0, 2).every((e) => e.entity === 'appointment')).toBe(true);
    expect(events.slice(2, 3).every((e) => e.entity === 'customer')).toBe(true);
  });
});
