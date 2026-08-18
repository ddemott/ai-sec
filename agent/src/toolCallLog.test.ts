import { describe, expect, it } from 'vitest';

import { MAX_RESULT_CHARS, MAX_TOOL_LOG_ENTRIES, ToolCallLog } from './toolCallLog.js';

// WHO: the FunctionToolsExecuted listener (index.ts) feeding executed batches;
//      drained once by finalizeCall into voice_sessions.metadata.tool_calls.
// WHAT: per-call tool trace — name, redacted args, ok, offset, duration.
// WHY: the Pino copy of this data rotates with the container. The 2026-07-27
//      calls lost every tool trace to a restart, and call #8's postmortem
//      ("no booked time on file", said to a caller WITH a booking) ended at
//      three undecidable candidate causes. This log makes it one SQL query.
describe('ToolCallLog', () => {
  const call = (
    over: Partial<{ callId: string; name: string; args: string; createdAt: number }>
  ) => ({
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
    log.recordBatch([call({ args: '{"phone":"2624979039","note":"call 262-497-9039 back"}' })], []);
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

/**
 * WHO: anyone reading voice_sessions.metadata.tool_calls after a bad call.
 * WHAT: the tool's REPLY, not just the request and a did-not-throw flag.
 * WHEN: 2026-08-13, calls SCL_3a8SkDKzxN4B and SCL_KLvqZ2JkaQFU.
 * WHERE: recordBatch, pairing FunctionCallOutput.output with its call.
 * WHY: both postmortems stalled on the same hole. `set_purpose` adding the job
 *      tree logged ok:true while the host was refusing it, and a
 *      book_with_scheduling that booked nothing also logged ok:true — leaving
 *      two candidate causes and no evidence to choose between them. `ok` means
 *      "did not throw", which is not the same as "worked".
 */
describe('tool result capture (2026-08-13 blind spot)', () => {
  const at = (
    tool: string,
    output: string
  ): [
    Array<{ callId: string; name: string; args: string; createdAt: number }>,
    Array<{ callId: string; isError: boolean; createdAt: number; output: string }>,
  ] => [
    [{ callId: 'c1', name: tool, args: '{}', createdAt: 1000 }],
    [{ callId: 'c1', isError: false, createdAt: 1010, output }],
  ];

  it('records a host refusal that came back as a successful tool result', () => {
    const log = new ToolCallLog(0);
    log.recordBatch(
      ...at(
        'set_purpose',
        'The "job" intake is not enabled for this business, so its questions are not available.'
      )
    );
    const [entry] = log.toPayload()!.entries;
    expect(entry.ok).toBe(true); // unchanged — the tool genuinely did not throw
    expect(entry.result).toContain('"job" intake is not enabled');
  });

  it('keeps the decision fields of a failed write, not the whole payload', () => {
    const log = new ToolCallLog(0);
    log.recordBatch(
      ...at(
        'book_with_scheduling',
        JSON.stringify({
          success: false,
          error: 'No open slot in that window.',
          error_code: 'NO_AVAILABILITY',
          next_available: [],
        })
      )
    );
    const [entry] = log.toPayload()!.entries;
    expect(entry.result).toContain('success=false');
    expect(entry.result).toContain('error_code=NO_AVAILABILITY');
  });

  it('keeps the row id a successful write produced, for joining the record', () => {
    const log = new ToolCallLog(0);
    log.recordBatch(...at('take_message', JSON.stringify({ success: true, message_id: 'msg_42' })));
    expect(log.toPayload()!.entries[0].result).toContain('message_id=msg_42');
  });

  it('SAD: never copies caller data out of a reply that carries it', () => {
    const log = new ToolCallLog(0);
    log.recordBatch(
      ...at(
        'get_customer_context',
        JSON.stringify({
          success: true,
          customer: { name: 'Camille DeMott', phone: '+12624979039', address: '331 Ridley St.' },
        })
      )
    );
    const result = log.toPayload()!.entries[0].result ?? '';
    expect(result).not.toContain('Camille');
    expect(result).not.toContain('2624979039');
    expect(result).not.toContain('Ridley');
  });

  it('SAD: cuts a prose refusal before the CHECKLIST STATE block of caller answers', () => {
    const log = new ToolCallLog(0);
    log.recordBatch(
      ...at(
        'finish_call',
        'Not yet — the checklist is not complete. Finish these first.\nCHECKLIST STATE\ncaller_name [✓] Camille DeMott'
      )
    );
    const result = log.toPayload()!.entries[0].result ?? '';
    expect(result).toContain('checklist is not complete');
    expect(result).not.toContain('Camille');
  });

  it('SAD: caps a runaway result so one entry cannot bloat the jsonb', () => {
    const log = new ToolCallLog(0);
    log.recordBatch(...at('answer_question', 'x'.repeat(50_000)));
    expect((log.toPayload()!.entries[0].result ?? '').length).toBe(MAX_RESULT_CHARS);
  });

  it('omits result entirely when no output arrived (absence means absence)', () => {
    const log = new ToolCallLog(0);
    log.recordBatch([{ callId: 'c1', name: 'set_purpose', args: '{}', createdAt: 1000 }], []);
    expect(log.toPayload()!.entries[0]).not.toHaveProperty('result');
  });
});
