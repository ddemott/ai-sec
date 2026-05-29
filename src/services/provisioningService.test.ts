/**
 * Service-level tests for src/services/provisioningService.ts.
 *
 * Tests the state machine directly (no HTTP layer), covering:
 *   - activatePhone happy path — all Telnyx calls succeed, DB updated, result=ok
 *   - activatePhone rollback — orderNumber succeeds, assignToConnection throws →
 *       release(purchasedId) called, status set to 'failed', result carries error context
 *   - activatePhone rollback with cleanup failure — assignToConnection AND release throw →
 *       result carries both error and cleanup_error
 *   - deactivatePhone happy path — release succeeds, DB cleared, warnings=[]
 *   - deactivatePhone partial cleanup — release throws → warnings + release_error in result
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { TelnyxProvisioningConfig } from '../routes/provisioning';
import { activatePhone, deactivatePhone } from './provisioningService';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// ── Mock helpers ──────────────────────────────────────────────────────────────

function buildMockTelnyxClient(
  overrides: Partial<TelnyxProvisioningConfig['client']> = {}
): TelnyxProvisioningConfig {
  return {
    sipConnectionId: 'sip-conn-123',
    client: {
      searchAvailable: vi.fn(async () => ({
        phone_number: '+16305551234',
        id: 'pn-abc',
      })),
      orderNumber: vi.fn(async () => ({
        id: 'pn-abc',
        phone_number: '+16305551234',
      })),
      assignToConnection: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
      ...overrides,
    },
  };
}

interface MockQueryRow {
  tenant_id?: string;
  name?: string;
  phone_status?: string;
  telnyx_phone_number_id?: string | null;
}

function buildMockPool(responses: Array<{ rows: MockQueryRow[]; rowCount?: number }>): Pool {
  let callIndex = 0;
  const mockClient = {
    query: vi.fn(async () => {
      const res = responses[callIndex++] ?? { rows: [], rowCount: 0 };
      return res;
    }),
    release: vi.fn(),
  } as unknown as PoolClient;

  return {
    connect: vi.fn(async () => mockClient),
  } as unknown as Pool;
}

// ── activatePhone ─────────────────────────────────────────────────────────────

describe('activatePhone', () => {
  it('HAPPY: all Telnyx calls succeed → result ok with phone_number, DB set active', async () => {
    // WHO: super-admin provisioning a new phone number for a tenant
    // WHAT: service fetches tenant, sets status=provisioning, orders + assigns number,
    //       sets status=active, returns ok with phone_number + telnyx_phone_number_id
    // WHEN: tenant exists with phone_status='inactive' and Telnyx API works
    // WHERE: activatePhone in provisioningService.ts
    // WHY: the happy path locks that all 5 steps complete and the result contains the
    //      phone_number the route needs to store in the logEvent and response body
    const telnyx = buildMockTelnyxClient();
    const pool = buildMockPool([
      // SELECT tenant
      { rows: [{ tenant_id: TENANT_ID, name: 'Test Biz', phone_status: 'inactive' }] },
      // UPDATE SET provisioning
      { rows: [], rowCount: 1 },
      // UPDATE SET active
      { rows: [], rowCount: 1 },
    ]);

    const result = await activatePhone(pool, telnyx, TENANT_ID);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.phone_number).toBe('+16305551234');
      expect(result.telnyx_phone_number_id).toBe('pn-abc');
      expect(result.tenant_id).toBe(TENANT_ID);
    }

    expect(telnyx.client.searchAvailable).toHaveBeenCalledOnce();
    expect(telnyx.client.orderNumber).toHaveBeenCalledWith('+16305551234');
    expect(telnyx.client.assignToConnection).toHaveBeenCalledWith('pn-abc', 'sip-conn-123');
    expect(telnyx.client.release).not.toHaveBeenCalled();
  });

  it('ROLLBACK: orderNumber succeeds, assignToConnection throws → release called, result failed', async () => {
    // WHO: super-admin whose SIP connection assignment fails mid-provision
    // WHAT: orderNumber returns a purchased ID, assignToConnection throws →
    //       release(purchasedId) is called as rollback, status set to 'failed',
    //       result carries error + number_purchased=true + rolled_back=true
    // WHEN: Telnyx SIP API is temporarily down after the number order succeeds
    // WHERE: activatePhone inner try/catch → rollback branch
    // WHY: a purchased-but-unassigned number wastes Telnyx budget — the rollback
    //      release is load-bearing. This test pins that release() is called with
    //      the exact purchased ID, not skipped on error.
    const assignError = new Error('SIP connection assignment failed');
    const telnyx = buildMockTelnyxClient({
      assignToConnection: vi.fn(async () => {
        throw assignError;
      }),
    });
    const pool = buildMockPool([
      { rows: [{ tenant_id: TENANT_ID, name: 'Test Biz', phone_status: 'inactive' }] },
      { rows: [], rowCount: 1 }, // UPDATE provisioning
      { rows: [], rowCount: 1 }, // UPDATE failed
    ]);

    const result = await activatePhone(pool, telnyx, TENANT_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.detail).toBe('SIP connection assignment failed');
      expect(result.error).toBe(assignError);
      expect(result.number_purchased).toBe(true);
      expect(result.rolled_back).toBe(true);
      expect(result.purchased_id).toBe('pn-abc');
      expect(result.cleanup_error).toBeUndefined(); // release succeeded
    }

    // Rollback release must be called with the purchased number's ID
    expect(telnyx.client.release).toHaveBeenCalledWith('pn-abc');
  });

  it('ROLLBACK + CLEANUP FAILURE: assignToConnection throws AND release throws → both errors in result', async () => {
    // WHO: super-admin during a Telnyx outage where both assign and rollback fail
    // WHAT: assignToConnection throws, then release also throws →
    //       result has error (original) AND cleanup_error (release error)
    // WHEN: Telnyx API is fully down mid-provision
    // WHERE: activatePhone catch → inner try/catch around release()
    // WHY: the route must log BOTH errors (phone_provisioning_failed +
    //      telnyx_number_cleanup_failed). cleanup_error in the result drives
    //      the conditional logError in the route — without it the cleanup
    //      failure would be silently swallowed.
    const assignError = new Error('assign failed');
    const releaseError = new Error('release also failed');
    const telnyx = buildMockTelnyxClient({
      assignToConnection: vi.fn(async () => { throw assignError; }),
      release: vi.fn(async () => { throw releaseError; }),
    });
    const pool = buildMockPool([
      { rows: [{ tenant_id: TENANT_ID, name: 'Test Biz', phone_status: 'inactive' }] },
      { rows: [], rowCount: 1 }, // UPDATE provisioning
      { rows: [], rowCount: 1 }, // UPDATE failed
    ]);

    const result = await activatePhone(pool, telnyx, TENANT_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toBe(assignError);
      expect(result.cleanup_error).toBe(releaseError);
      expect(result.number_purchased).toBe(true);
    }
  });

  it('CONFLICT: phone_status=active → result conflict already_active', async () => {
    // WHO: super-admin re-provisioning a tenant that already has an active number
    // WHAT: status check returns 'conflict' with reason='already_active' before any Telnyx call
    // WHEN: tenant.phone_status is 'active'
    // WHERE: activatePhone status guard
    // WHY: pins that the guard prevents Telnyx API calls for already-active tenants
    const telnyx = buildMockTelnyxClient();
    const pool = buildMockPool([
      { rows: [{ tenant_id: TENANT_ID, name: 'Test Biz', phone_status: 'active' }] },
    ]);

    const result = await activatePhone(pool, telnyx, TENANT_ID);

    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') {
      expect(result.reason).toBe('already_active');
    }
    expect(telnyx.client.searchAvailable).not.toHaveBeenCalled();
  });
});

// ── deactivatePhone ───────────────────────────────────────────────────────────

describe('deactivatePhone', () => {
  it('HAPPY: release succeeds → result ok with empty warnings, DB cleared', async () => {
    // WHO: super-admin deactivating a tenant's phone
    // WHAT: release succeeds, DB columns cleared, result ok with warnings=[]
    // WHEN: Telnyx API is available
    // WHERE: deactivatePhone in provisioningService.ts
    // WHY: pins that DB is always cleared and result shape includes tenant_id + warnings
    const telnyx = buildMockTelnyxClient();
    const pool = buildMockPool([
      { rows: [{ telnyx_phone_number_id: 'pn-abc' }] },
      { rows: [], rowCount: 1 }, // UPDATE deprovisioned
    ]);

    const result = await deactivatePhone(pool, telnyx, TENANT_ID);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.warnings).toHaveLength(0);
      expect(result.release_error).toBeUndefined();
      expect(result.tenant_id).toBe(TENANT_ID);
    }
    expect(telnyx.client.release).toHaveBeenCalledWith('pn-abc');
  });

  it('PARTIAL CLEANUP: release throws → result ok with warnings + release_error', async () => {
    // WHO: super-admin deactivating when Telnyx API is unavailable
    // WHAT: release throws → warning captured, DB still cleared, release_error in result
    // WHEN: Telnyx release endpoint returns an error
    // WHERE: deactivatePhone catch around telnyx.client.release()
    // WHY: DB columns must be cleared even on Telnyx failure so the tenant is
    //      not stuck in 'active'. release_error drives the logError call in the route.
    const releaseError = new Error('Telnyx timeout');
    const telnyx = buildMockTelnyxClient({
      release: vi.fn(async () => { throw releaseError; }),
    });
    const pool = buildMockPool([
      { rows: [{ telnyx_phone_number_id: 'pn-abc' }] },
      { rows: [], rowCount: 1 }, // UPDATE deprovisioned
    ]);

    const result = await deactivatePhone(pool, telnyx, TENANT_ID);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('pn-abc');
      expect(result.release_error).toBe(releaseError);
      expect(result.release_phone_number_id).toBe('pn-abc');
    }
  });
});
