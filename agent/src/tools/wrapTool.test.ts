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
