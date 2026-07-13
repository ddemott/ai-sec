/**
 * Tests for the never-freeze tool contract. Each case proves the wrapped
 * execute always resolves to a non-empty string within bounds — never throws,
 * never hangs, never returns nothing — so no tool can leave the caller silent.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { wrapToolExecute } from './wrapTool.js';

const FALLBACK_MARK = 'take a message';

describe('wrapToolExecute', () => {
  afterEach(() => vi.useRealTimers());

  it('HAPPY: passes a normal string result straight through', async () => {
    // WHO: a healthy tool returning its answer.
    // WHAT: the wrapper is transparent on the happy path.
    // WHERE: wrapToolExecute success branch (typeof result === 'string', non-empty).
    // WHEN: every normal tool call.
    // WHY: hardening must not change correct behavior.
    const wrapped = wrapToolExecute('t', async () => 'the answer');
    expect(await wrapped({}, {})).toBe('the answer');
  });

  it('SAD: a thrown error becomes the graceful fallback (never rejects)', async () => {
    // WHO: a tool whose backend/SDK throws.
    // WHAT: the throw is caught and converted to a speakable fallback; onError fires.
    // WHERE: wrapToolExecute catch branch.
    // WHEN: backend down / unexpected exception.
    // WHY: a rejected promise would orphan the generation → dead air.
    const onError = vi.fn();
    const wrapped = wrapToolExecute(
      't',
      async () => {
        throw new Error('backend exploded');
      },
      { onError }
    );
    const out = await wrapped({}, {});
    expect(out).toContain(FALLBACK_MARK);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ tool: 't', reason: 'threw' }));
  });

  it('SAD: an empty string becomes the fallback (no silent turn)', async () => {
    // WHO: a tool that returns ''.
    // WHAT: empty result → fallback, onError reason 'empty'.
    // WHERE: wrapToolExecute string-empty branch.
    // WHEN: a backend returns success with no message.
    // WHY: the LLM must always have something to relay.
    const onError = vi.fn();
    const wrapped = wrapToolExecute('t', async () => '', { onError });
    expect(await wrapped({}, {})).toContain(FALLBACK_MARK);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ reason: 'empty' }));
  });

  it('SAD: undefined result becomes the fallback', async () => {
    // WHO/WHAT: a tool returning undefined → fallback.
    // WHERE: wrapToolExecute non-string branch. WHEN: a void-ish return.
    // WHY: JSON.stringify(undefined) is the JS value undefined — never relay that.
    const wrapped = wrapToolExecute('t', async () => undefined);
    expect(await wrapped({}, {})).toContain(FALLBACK_MARK);
  });

  it('HAPPY: a non-string object result is JSON-encoded', async () => {
    // WHO/WHAT: a tool returning an object → JSON string. WHERE: non-string branch.
    // WHEN: structured results. WHY: the LLM relays JSON shapes fine.
    const wrapped = wrapToolExecute('t', async () => ({ ok: true }));
    expect(await wrapped({}, {})).toBe('{"ok":true}');
  });

  it('SAD: a hanging execute times out to the fallback (cannot freeze the turn)', async () => {
    // WHO: a tool whose promise never settles (hung backend / SIP REFER).
    // WHAT: Promise.race against the ceiling resolves to the fallback.
    // WHERE: wrapToolExecute timeout branch. WHEN: a true hang.
    // WHY: the framework has no per-tool timeout — this is the only bound.
    vi.useFakeTimers();
    const onError = vi.fn();
    const wrapped = wrapToolExecute('t', () => new Promise<string>(() => {}), {
      timeoutMs: 5000,
      onError,
    });
    const p = wrapped({}, {});
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toContain(FALLBACK_MARK);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ reason: 'timeout' }));
  });

  it('SAD: an onError that throws does NOT break the contract (still returns the fallback)', async () => {
    // WHO: a misbehaving diagnostics sink (logger throws).
    // WHAT: report() swallows the onError throw; the wrapper still returns the fallback.
    // WHERE: the report() helper guarding every sad-path onError call.
    // WHEN: a logging failure coincides with a tool error.
    // WHY: diagnostics must never be able to turn a graceful fallback back into a rejection.
    const wrapped = wrapToolExecute(
      't',
      async () => {
        throw new Error('boom');
      },
      {
        onError: () => {
          throw new Error('logger blew up');
        },
      }
    );
    await expect(wrapped({}, {})).resolves.toContain(FALLBACK_MARK);
  });

  it('respects a custom fallback string', async () => {
    // WHO/WHAT: a caller overriding the fallback copy. WHY: per-agent wording.
    const wrapped = wrapToolExecute('t', async () => '', { fallback: 'custom hold' });
    expect(await wrapped({}, {})).toBe('custom hold');
  });
});

/**
 * EVERY tool call must be observable — including the ones that succeed.
 *
 * WHY (2026-07-13, a real call): the agent told the caller "I just sent you a
 * text with a verification code" and "I see that 3 PM is taken". Neither was
 * true — no verification row was ever written, and the calendar was empty that
 * day. The model had NARRATED TOOL CALLS IT NEVER MADE.
 *
 * And we could not see it. This wrapper logged only FAILURES, so a tool the
 * model never invoked and a tool that ran perfectly looked identical: silent.
 * Diagnosing it meant counting rows across six tables and reasoning backwards
 * ("customers is empty, therefore identify_caller was never called").
 *
 * A hallucinated tool call is invisible BY CONSTRUCTION unless you log the calls
 * that really happened — the absence in the log is the evidence. So `onCall`
 * fires on every invocation, and these tests keep it that way.
 */
describe('wrapToolExecute — onCall observability', () => {
  it('HAPPY: a SUCCESSFUL call is reported (this is the case that was invisible)', async () => {
    const calls: { tool: string; ok: boolean }[] = [];
    const wrapped = wrapToolExecute('identify_caller', async () => ({ saved: true }), {
      onCall: ({ tool, ok }) => calls.push({ tool, ok }),
    });

    await wrapped({} as never, {} as never);

    expect(calls).toEqual([{ tool: 'identify_caller', ok: true }]);
  });

  it('SAD: a THROWING call is reported as not-ok (and still returns the fallback)', async () => {
    const calls: { tool: string; ok: boolean }[] = [];
    const wrapped = wrapToolExecute(
      'send_verification_code',
      async () => {
        throw new Error('backend 500');
      },
      { onCall: ({ tool, ok }) => calls.push({ tool, ok }) }
    );

    const out = await wrapped({} as never, {} as never);

    expect(calls).toEqual([{ tool: 'send_verification_code', ok: false }]);
    expect(out).toContain(FALLBACK_MARK); // contract still holds
  });

  it('the log carries what the model was HANDED — the gap where a hallucination lives', async () => {
    // WHO: whoever is diagnosing a call where the agent said something untrue.
    // WHAT: the log must carry the RESULT the model received, not just the tool name.
    // WHEN: every tool call.
    // WHERE: wrapToolExecute → onCall.resultPreview.
    // WHY: knowing a tool RAN is not enough. To catch "the tool said X and the agent
    //      then said Y" — the 2026-07-13 failure — you need X.
    let preview: string | undefined;
    const wrapped = wrapToolExecute('get_available_slots', async () => ({ slots: ['3:00 PM'] }), {
      onCall: (info) => {
        preview = info.resultPreview;
      },
    });

    await wrapped({} as never, {} as never);

    expect(preview).toContain('3:00 PM');
  });

  it('SECURITY: a customer name / phone / code is REDACTED before it reaches the log', async () => {
    // WHO: every customer whose data passes through a tool result.
    // WHAT: the preview must carry the SHAPE of the result, never its contents.
    // WHEN: every tool call — this logs at INFO, on every call, to centralised logs.
    // WHERE: wrapToolExecute preview().
    // WHY: raised in review on #248, and it was right. The first version logged the
    //      RAW result. Tool results carry a customer's name, phone, preferences and
    //      history — and a verification flow carries CODES. That would have turned an
    //      observability feature into a PII leak, in the very PR whose purpose was to
    //      see more clearly. Diagnostics must not become a second copy of the CRM.
    //
    //      The KEY survives ("name" is present) because that is what proves the tool
    //      RAN — the whole point. The VALUE does not.
    let preview: string | undefined;
    const wrapped = wrapToolExecute(
      'identify_caller',
      async () => ({
        name: 'Camille Rousseau',
        phone: '+16082175303',
        code: '1234',
        preferences: { preferred_stylist: 'Maria' },
      }),
      { onCall: (info) => void (preview = info.resultPreview) }
    );

    await wrapped({} as never, {} as never);

    // The values are gone.
    expect(preview).not.toContain('Camille Rousseau');
    expect(preview).not.toContain('Maria');
    expect(preview).not.toContain('6082175303');
    expect(preview).not.toContain('1234');
    // The shape survives — "a name came back" is exactly what distinguishes
    // "the tool ran" from "the model made it up".
    expect(preview).toContain('name');
    expect(preview).toContain('[redacted]');
    // Last 4 kept so a call can still be correlated to a customer.
    expect(preview).toContain('5303');
  });

  it('a THROWING logger can never break the tool contract', async () => {
    // WHY: diagnostics are best-effort. A logger that throws must not turn a
    //      graceful fallback back into a rejected promise — that would convert an
    //      observability feature into a dead-air bug, which is the exact trade
    //      this whole wrapper exists to prevent.
    const wrapped = wrapToolExecute('take_message', async () => 'Saved.', {
      onCall: () => {
        throw new Error('logger exploded');
      },
    });

    await expect(wrapped({} as never, {} as never)).resolves.toBe('Saved.');
  });
});
