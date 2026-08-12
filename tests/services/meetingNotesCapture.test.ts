import { describe, expect, it } from 'vitest';
import {
  persistMeetingNotesCapture,
  type MeetingNotesCaptureArgs,
} from '../../src/services/meetingNotesCapture';

type MockQueryResult = { rows: Array<Record<string, unknown>>; rowCount?: number };
type RecordedQuery = { text: string; params: unknown[] };

function makeDeps(queryResponses: MockQueryResult[]) {
  const queries: RecordedQuery[] = [];
  const queue = [...queryResponses];
  const client = {
    async query(text: string, params: unknown[] = []) {
      queries.push({ text, params });
      if (queue.length === 0) throw new Error(`No mock response left for query: ${text}`);
      const next = queue.shift()!;
      return { rows: next.rows, rowCount: next.rowCount ?? next.rows.length };
    },
  };
  const withTenantClient = async <T>(
    tenantId: string,
    fn: (client: typeof client) => Promise<T>
  ) => {
    expect(tenantId).toBe('tenant-1');
    return fn(client);
  };
  return { queries, withTenantClient };
}

describe('persistMeetingNotesCapture', () => {
  const args: MeetingNotesCaptureArgs = {
    tenant_id: 'tenant-1',
    appointment_id: 'appt-1',
    caller_name: 'Kim',
    callback_phone: '+16305550147',
    notes: 'They run a mobile dog grooming business and want help with everything.',
    call_id: 'call-1',
  };

  it('writes generic intake first, then projects onto appointment description', async () => {
    const deps = makeDeps([
      { rows: [{ appointment_id: 'appt-1' }] },
      { rows: [{ submission_id: 'sub-1' }] },
      { rows: [{ appointment_id: 'appt-1' }], rowCount: 1 },
    ]);

    const result = await persistMeetingNotesCapture({
      args,
      withTenantClient: deps.withTenantClient,
    });

    expect(result).toEqual({
      appointment_id: 'appt-1',
      appointmentLinkMiss: false,
      appointmentStampMiss: false,
    });
    expect(deps.queries[1].text).toContain('INSERT INTO intake_submissions');
    expect(deps.queries[1].params[2]).toBe('meeting_notes');
    expect(String(deps.queries[1].params[7])).toContain('mobile dog grooming');
    expect(deps.queries[2].text).toContain('UPDATE appointments');
    expect(deps.queries[2].params[2]).toBe(
      'Caller notes: They run a mobile dog grooming business and want help with everything.'
    );
  });

  it('returns link miss when appointment is not live for this tenant', async () => {
    const deps = makeDeps([{ rows: [] }]);

    const result = await persistMeetingNotesCapture({
      args,
      withTenantClient: deps.withTenantClient,
    });

    expect(result).toEqual({
      appointment_id: null,
      appointmentLinkMiss: true,
      appointmentStampMiss: false,
    });
    expect(deps.queries).toHaveLength(1);
  });
});
