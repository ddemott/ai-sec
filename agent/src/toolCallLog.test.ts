import { describe, expect, it } from 'vitest';

import { MAX_TOOL_LOG_ENTRIES, ToolCallLog } from './toolCallLog.js';

// WHO: the FunctionToolsExecuted listener (index.ts) feeding executed batches;
//      drained once by finalizeCall into voice_sessions.metadata.tool_calls.
// WHAT: per-call tool trace — name, redacted args, ok, offset, duration.
// WHY: the Pino copy of this data rotates with the container. The 2026-07-27
//      calls lost every tool trace to a restart, and call #8's postmortem
//      ("no booked time on file", said to a caller WITH a booking) ended at
//      three undecidable candidate causes. This log makes it one SQL query.
describe('ToolCallLog', () => {
  const call = (over: Partial<{ callId: string; name: string; args: string; createdAt: number }>) => ({
    callId: 'c1',
    name: 'get_available_slots',
    args: '{"date":"2026-07-30"}',
    createdAt: 5_000,
    ...over,
  });

  it('HAPPY: pairs calls with outputs — offset, ok, and duration recorded', () => {
    const log = new ToolCallLog(1_000);
    log.recordBatch(
      [call({ callId: 'c1', createdAt: 5_000 })],
      [{ callId: 'c1', isError: false, createdAt: 5_450 }]
    );
    expect(log.toPayload()).toEqual({
      entries: [
        {
          t: 4_000, // 5000 - callStart 1000
          tool: 'get_available_slots',
          args: { date: '2026-07-30' },
          ok: true,
          ms: 450,
        },
      ],
      dropped: 0,
    });
  });

  it('HAPPY: an errored output records ok:false; a missing output records null/null', () => {
    const log = new ToolCallLog(0);
    log.recordBatch(
      [call({ callId: 'c1' }), call({ callId: 'c2', name: 'book_with_scheduling' })],
      [{ callId: 'c1', isError: true, createdAt: 6_000 }] // c2's output never arrived
    );
    const p = log.toPayload()!;
    expect(p.entries[0].ok).toBe(false);
    expect(p.entries[1]).toMatchObject({ tool: 'book_with_scheduling', ok: null, ms: null });
  });

  it('SAD: args are PII-redacted before they are stored — a phone number never lands raw', () => {
    // The payload is written to the DB and shown in postmortems; redactToolArgs
    // is applied at RECORD time so no raw-PII window exists in memory either.
    const log = new ToolCallLog(0);
    log.recordBatch(
      [call({ args: '{"phone":"2624979039","note":"call 262-497-9039 back"}' })],
      []
    );
    const args = log.toPayload()!.entries[0].args as { phone: string; note: string };
    expect(args.phone).not.toContain('2624979039');
    expect(args.note).not.toContain('262-497-9039');
  });

  it('SAD: entries past the cap are COUNTED, not stored — a runaway loop cannot grow the row', () => {
    const log = new ToolCallLog(0);
    for (let i = 0; i < MAX_TOOL_LOG_ENTRIES + 25; i++) {
      log.recordBatch([call({ callId: `c${i}` })], []);
    }
    const p = log.toPayload()!;
    expect(p.entries).toHaveLength(MAX_TOOL_LOG_ENTRIES);
    expect(p.dropped).toBe(25); // nonzero dropped IS the runaway evidence
  });

  it('SAD: malformed event fields never throw — this runs inside a live-call handler', () => {
    const log = new ToolCallLog(0);
    expect(() =>
      log.recordBatch([null, undefined, {}, { name: 'x', args: 'not json' }], [null, {}])
    ).not.toThrow();
    expect(log.size).toBe(4);
  });

  it('empty log ships NOTHING — absence in metadata means no tool ever fired', () => {
    expect(new ToolCallLog().toPayload()).toBeNull();
  });
});
