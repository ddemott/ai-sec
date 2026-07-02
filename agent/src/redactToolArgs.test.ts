/**
 * Tests for redactToolArgs / summarizeToolCalls — the PII scrubber that lets
 * the agent log tool-call ARGUMENTS (not just tool names) to centralized logs.
 *
 * WHO: the FunctionToolsExecuted handler in agent/src/index.ts
 * WHAT: redact phone numbers + verification codes from tool args while
 *       PRESERVING time strings, service names, and caller names — the
 *       debugging payload (a 2026-07-01 live incident couldn't be diagnosed
 *       because the logs didn't show what time string the LLM sent).
 * WHERE: agent/src/redactToolArgs.ts
 * WHEN: on every LLM tool invocation during a live call
 * WHY: raw args carry caller PII (phone, OTP codes); logs are shipped to
 *      Better Stack — precedent is the transcript preview (words kept,
 *      digits masked), applied here per-key so booking times stay readable.
 */
import { describe, it, expect } from 'vitest';
import { redactToolArgs, summarizeToolCalls } from './redactToolArgs.js';

describe('redactToolArgs', () => {
  it('masks every digit of phone-named keys (phone, callback_phone)', () => {
    // WHY: phone keys are pure PII — no debugging value in the digits,
    // shape/length is enough to see "a 10-digit number was sent".
    const out = redactToolArgs(
      JSON.stringify({ phone: '608-217-5303', callback_phone: '+16082175303' })
    ) as Record<string, unknown>;
    expect(out.phone).toBe('•••-•••-••••');
    expect(out.callback_phone).toBe('+•••••••••••');
  });

  it('masks verification code values entirely', () => {
    // WHY: verify_phone_code carries a live OTP — logging it would let a
    // log reader replay verification.
    const out = redactToolArgs(JSON.stringify({ phone: '6082175303', code: '123456' })) as Record<
      string,
      unknown
    >;
    expect(out.code).toBe('••••••');
  });

  it('preserves ISO time strings untouched (the debugging payload)', () => {
    // WHY: the entire point of arg logging is seeing what time window the
    // LLM sent — 2026-07-01's wrong-time booking was undiagnosable without it.
    const args = {
      service_type: 'oil change',
      window_from: '2026-07-02T16:30:00-05:00',
      window_to: '2026-07-02T17:00:00-05:00',
      date: '2026-07-02',
    };
    const out = redactToolArgs(JSON.stringify(args));
    expect(out).toEqual(args);
  });

  it('keeps caller names (transcript-preview precedent: words stay, digits go)', () => {
    const out = redactToolArgs(JSON.stringify({ name: 'Jane Doe', caller_name: 'Bob' })) as Record<
      string,
      unknown
    >;
    expect(out.name).toBe('Jane Doe');
    expect(out.caller_name).toBe('Bob');
  });

  it('masks a US-format phone embedded in free text but keeps the words', () => {
    // WHY: free-text fields (message/question/value) can carry a spoken
    // phone number; 3-3-4 with separators is the classic dictation shape.
    const out = redactToolArgs(
      JSON.stringify({ message: 'call me back at (608) 217-5303 after 4pm' })
    ) as Record<string, unknown>;
    expect(out.message).not.toContain('5303');
    expect(out.message).toContain('call me back at');
    expect(out.message).toContain('after 4pm');
  });

  it('masks 7+ consecutive digit runs in free text (raw phone dictation)', () => {
    const out = redactToolArgs(
      JSON.stringify({ question: 'my number is 6082175303 ok' })
    ) as Record<string, unknown>;
    expect(out.question).not.toContain('6082175303');
    expect(out.question).toContain('my number is');
  });

  it('leaves short digit groups in free text alone (times, prices)', () => {
    const out = redactToolArgs(
      JSON.stringify({ value: 'prefers 4:30 slots, budget 150' })
    ) as Record<string, unknown>;
    expect(out.value).toBe('prefers 4:30 slots, budget 150');
  });

  it('recurses into nested objects and arrays', () => {
    const out = redactToolArgs(
      JSON.stringify({ nested: { phone: '6082175303' }, list: ['608-217-5303 is me'] })
    ) as {
      nested: { phone: string };
      list: string[];
    };
    expect(out.nested.phone).toBe('••••••••••');
    expect(out.list[0]).not.toContain('5303');
  });

  it('passes non-string primitives through unchanged', () => {
    const args = { count: 3, flag: true, nothing: null };
    expect(redactToolArgs(JSON.stringify(args))).toEqual(args);
  });

  it('returns a digit-masked _unparsed preview on invalid JSON (never throws)', () => {
    // WHY: sad path — a malformed args string from the LLM must not crash
    // the logging handler mid-call; we still want a masked peek at it.
    const out = redactToolArgs('not json 6082175303') as Record<string, unknown>;
    expect(out._unparsed).toBeDefined();
    expect(String(out._unparsed)).not.toContain('6082175303');
  });

  it('masks BEFORE truncating — a phone straddling the truncation boundary cannot leak a fragment', () => {
    // WHY: truncate-then-mask would slice "…6082175303" at the 300-char
    // boundary leaving a 5-digit tail that matches neither LONG_DIGIT_RUN
    // nor the 3-3-4 shape — partial PII in centralized logs (Copilot
    // review finding on PR #157).
    const straddling = 'x'.repeat(295) + '6082175303 rest';
    const out = redactToolArgs(JSON.stringify({ question: straddling })) as Record<string, unknown>;
    expect(String(out.question)).not.toMatch(/\d/);
    expect(String(out.question).length).toBeLessThanOrEqual(300);
  });

  it('truncates very long string values to bound log size', () => {
    const out = redactToolArgs(JSON.stringify({ question: 'x'.repeat(5000) })) as Record<
      string,
      unknown
    >;
    expect(String(out.question).length).toBeLessThanOrEqual(300);
  });
});

describe('summarizeToolCalls', () => {
  it('pairs each call with its output isError by callId', () => {
    // WHY: "tool ran" without "tool failed?" forced log-inference during the
    // 2026-07-01 incident; is_error makes the sad path visible per call.
    const out = summarizeToolCalls(
      [
        { callId: 'c1', name: 'get_available_slots', args: '{"date":"2026-07-02"}' },
        { callId: 'c2', name: 'book_with_scheduling', args: '{"phone":"6082175303"}' },
      ],
      [
        { callId: 'c1', isError: false },
        { callId: 'c2', isError: true },
      ]
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      name: 'get_available_slots',
      is_error: false,
      args: { date: '2026-07-02' },
    });
    expect(out[1]).toMatchObject({ name: 'book_with_scheduling', is_error: true });
    expect((out[1].args as Record<string, unknown>).phone).toBe('••••••••••');
  });

  it('tolerates missing output for a call (is_error null) and missing fields', () => {
    // WHY: functionCallOutputs can lag or be absent; the logger must not throw.
    const out = summarizeToolCalls([{ name: undefined, callId: undefined, args: undefined }], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: '(unknown)', is_error: null });
  });
});
