import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { resolveServiceForBooking } from '../../src/services/serviceResolver';

// A mock client whose query() returns the queued responses in order. Proves
// the resolver's BRANCHING (match → tenant default → safety → null) and that
// each fallthrough only runs when the prior step came back empty.
function mockClient(responses: Array<{ rows: unknown[] }>): {
  client: PoolClient;
  calls: Array<{ text: string; params: unknown[] }>;
} {
  const queue = [...responses];
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      calls.push({ text, params: params || [] });
      return queue.shift() || { rows: [] };
    }),
  } as unknown as PoolClient;
  return { client, calls };
}

const SVC = (name: string) => ({
  service_id: `svc-${name}`,
  name,
  duration_minutes: 30,
  price: null,
  required_skills: ['consultation'],
});

const TENANT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('resolveServiceForBooking', () => {
  it('HAPPY: a spoken type that matches a service uses it (one query, no fallthrough)', async () => {
    // WHO: caller who said a service name that substring-matches a real one.
    // WHAT: the name-match query returns a row → resolver stops there.
    // WHY: an exact-enough name must NOT be overridden by the default.
    const { client, calls } = mockClient([{ rows: [SVC('Programming Consultation')] }]);
    const res = await resolveServiceForBooking(client, TENANT, 'consultation');
    expect(res?.name).toBe('Programming Consultation');
    expect(calls).toHaveLength(1); // match only — no default/safety queries
    expect(calls[0].params).toEqual([TENANT, 'consultation']);
  });

  it('HAPPY: an unmatched type FALLS THROUGH to the tenant default (the catch-all)', async () => {
    // WHO: caller who said "a meeting" / "talk to Dale" — no name match.
    // WHAT: match returns empty → resolver queries the tenant default_service_id.
    // WHY: THE fix — no phrasing dead-ends; the default is the guaranteed else.
    const { client, calls } = mockClient([
      { rows: [] }, // match: miss
      { rows: [SVC('Programming Consultation')] }, // tenant default
    ]);
    const res = await resolveServiceForBooking(client, TENANT, 'a meeting');
    expect(res?.name).toBe('Programming Consultation');
    expect(calls).toHaveLength(2);
  });

  it('HAPPY: blank/undefined spoken type skips match and uses the default', async () => {
    // WHO: a flow that calls the resolver without any spoken service.
    // WHAT: no name to match → resolver goes straight to the tenant default.
    const { client, calls } = mockClient([{ rows: [SVC('Programming Consultation')] }]);
    const res = await resolveServiceForBooking(client, TENANT, '   ');
    expect(res?.name).toBe('Programming Consultation');
    // match query is skipped entirely for an empty spoken type — default is first.
    expect(calls).toHaveLength(1);
  });

  it('HAPPY: no default set → safety net picks the closest-to-30 bookable service', async () => {
    // WHO: a legacy tenant provisioned before default_service_id existed.
    // WHAT: match + default both empty → the safety query runs.
    const { client, calls } = mockClient([
      { rows: [] }, // match
      { rows: [] }, // default unset
      { rows: [SVC('Personal Callback')] }, // safety net
    ]);
    const res = await resolveServiceForBooking(client, TENANT, 'whatever');
    expect(res?.name).toBe('Personal Callback');
    expect(calls).toHaveLength(3);
  });

  it('SAD: tenant with no bookable service at all → null (caller handled gracefully)', async () => {
    // WHO: an unconfigured/empty tenant.
    // WHAT: every step empty → null; the caller (route) offers a message.
    const { client } = mockClient([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const res = await resolveServiceForBooking(client, TENANT, 'anything');
    expect(res).toBeNull();
  });
});
