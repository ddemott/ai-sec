/**
 * Tests for disconnectCrmIntegration — the shared disconnect helper used
 * by all four CRM provider routes (jobber, hubspot, square, servicetitan).
 * Happy + sad paths with 5W diagnostic context.
 */
import { describe, it, expect } from 'vitest';
import { disconnectCrmIntegration } from './crmDisconnect';
import { createMockClient } from '../test-utils-mock';

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('disconnectCrmIntegration — happy paths', () => {
  it('HAPPY: runs both DELETEs scoped to (tenant_id, provider)', async () => {
    // WHO: any of the four CRM /<provider>/settings/disconnect routes
    //      after a tenant clicks "Disconnect" on the integration card
    // WHAT: two DELETEs run against tenant_integration_settings and
    //       entity_sync_map with the same (tenant_id, provider) params
    // WHEN: every disconnect — the user-initiated provider unplug action
    // WHERE: src/services/crmDisconnect.ts → disconnectCrmIntegration
    // WHY: the helper centralizes the disconnect SQL so all four route
    //      handlers stay thin + uniform. A regression that drops one of
    //      the DELETEs would leave orphan rows: stale OAuth tokens (if
    //      tenant_integration_settings stays) or zombie sync mappings
    //      (if entity_sync_map stays). Pin both deletes happen + that
    //      they're scoped to the right (tenant, provider) tuple
    const { mockClient, queries, queryResponses } = createMockClient();
    queryResponses.push({ rows: [], rowCount: 1 });
    queryResponses.push({ rows: [], rowCount: 3 });

    await disconnectCrmIntegration(mockClient as never, TENANT_ID, 'jobber');

    expect(queries).toHaveLength(2);
    expect(queries[0].text).toContain('DELETE FROM tenant_integration_settings');
    expect(queries[0].params).toEqual([TENANT_ID, 'jobber']);
    expect(queries[1].text).toContain('DELETE FROM entity_sync_map');
    expect(queries[1].params).toEqual([TENANT_ID, 'jobber']);
  });

  it("HAPPY: passes the provider literal verbatim to both DELETEs", async () => {
    // WHO: the route handlers calling this helper for each provider
    // WHAT: provider param flows unchanged into both DELETE param arrays
    // WHEN: every CRM disconnect — verifies all four provider names work
    // WHERE: same helper; this test exists to catch a typo in the helper
    //       hardcoding the wrong provider literal (e.g., always 'jobber')
    // WHY: a regression here would cross-disconnect tenants — clicking
    //       "Disconnect HubSpot" would delete the Jobber settings row
    //       instead. Pin via parameterized provider checks across all
    //       four valid literals
    for (const provider of ['jobber', 'hubspot', 'square', 'servicetitan'] as const) {
      const { mockClient, queries, queryResponses } = createMockClient();
      queryResponses.push({ rows: [], rowCount: 0 });
      queryResponses.push({ rows: [], rowCount: 0 });

      await disconnectCrmIntegration(mockClient as never, TENANT_ID, provider);

      expect(queries[0].params).toEqual([TENANT_ID, provider]);
      expect(queries[1].params).toEqual([TENANT_ID, provider]);
    }
  });

  it('HAPPY: idempotent — succeeds when nothing exists to delete', async () => {
    // WHO: a tenant clicking Disconnect on an already-disconnected
    //      provider, or a stale UI replaying the action
    // WHAT: both DELETEs return rowCount=0 cleanly; helper does not
    //       throw or signal anything special
    // WHEN: replays of the same disconnect, double-clicks, race conditions
    // WHERE: helper return path
    // WHY: route handlers always return {success: true} after the helper
    //      runs. The helper must NOT distinguish "deleted N rows" from
    //      "deleted 0 rows" — that's an implementation detail. A
    //      regression that threw on rowCount=0 would surface a misleading
    //      error to the user when they're just retrying a successful
    //      disconnect
    const { mockClient, queries, queryResponses } = createMockClient();
    queryResponses.push({ rows: [], rowCount: 0 });
    queryResponses.push({ rows: [], rowCount: 0 });

    await expect(
      disconnectCrmIntegration(mockClient as never, TENANT_ID, 'square'),
    ).resolves.toBeUndefined();
    expect(queries).toHaveLength(2);
  });
});

describe('disconnectCrmIntegration — sad paths', () => {
  it('SAD: rejects (and stops) when the first DELETE throws', async () => {
    // WHO: a DB hiccup (lock timeout, connectivity blip) hitting the
    //      tenant_integration_settings DELETE
    // WHAT: helper propagates the error; the second DELETE on
    //       entity_sync_map does NOT run
    // WHEN: rare but real — concurrent migrations, write contention
    // WHERE: helper does not wrap in try/catch — error bubbles up
    // WHY: stopping early on the first failure is correct: route handlers
    //      catch the error and return a 500 envelope. If the helper
    //      caught + suppressed the first error, the user would see a
    //      success envelope while the disconnect actually failed —
    //      worst-case UX (silent corruption of the integration state)
    const { mockClient } = createMockClient();
    const queryFn = mockClient.query;
    queryFn.mockRejectedValueOnce(new Error('lock_not_available'));
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await expect(
      disconnectCrmIntegration(mockClient as never, TENANT_ID, 'jobber'),
    ).rejects.toThrow('lock_not_available');

    // The second DELETE must NOT have run
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('SAD: rejects when the second DELETE throws (first DELETE already committed if not in tx)', async () => {
    // WHO: same DB hiccup but on the entity_sync_map DELETE
    // WHAT: helper propagates the error after the first DELETE landed
    // WHEN: same as above; the first DELETE happened to succeed before
    //       the second hit a lock
    // WHERE: helper, sequential await chain
    // WHY: route caller must see the error so they return 500 instead
    //      of {success: true}. The first DELETE already ran — leaving
    //      the disconnect partially complete. Caller decides whether
    //      that's a retryable state or a manual-cleanup escalation;
    //      the helper's job is to surface the failure honestly
    const { mockClient } = createMockClient();
    const queryFn = mockClient.query;
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    queryFn.mockRejectedValueOnce(new Error('connection_terminated'));

    await expect(
      disconnectCrmIntegration(mockClient as never, TENANT_ID, 'hubspot'),
    ).rejects.toThrow('connection_terminated');

    // Both queries were attempted; vi-mock tracks .calls regardless of
    // whether the implementation overrides went through queries[].
    expect(queryFn).toHaveBeenCalledTimes(2);
    const firstCall = queryFn.mock.calls[0];
    expect(firstCall[0]).toContain('DELETE FROM tenant_integration_settings');
  });
});
