/**
 * Tests for the never-freeze tool contract. Each case proves the wrapped
 * execute always resolves to a non-empty string within bounds — never throws,
 * never hangs, never returns nothing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { wrapToolExecute } from './wrapTool.js';

const FALLBACK_MARK = 'take a message';

describe('wrapToolExecute', () => {
  afterEach(() => vi.useRealTimers());

  it('HAPPY: passes a normal string result straight through', async () => {
    const wrapped = wrapToolExecute('t', async () => 'the answer');
    expect(await wrapped({}, {})).toBe('the answer');
  });

  it('SAD: a thrown error becomes the graceful fallback (never rejects)', async () => {
    const onError = vi.fn();
    const wrapped = wrapToolExecute('t', async () => {
      throw new Error('backend exploded');
    }, { onError });
    const out = await wrapped({}, {});
    expect(out).toContain(FALLBACK_MARK);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ tool: 't', reason: 'threw' }));
  });

  it('SAD: an empty string becomes the fallback (no silent turn)', async () => {
    const onError = vi.fn();
    const wrapped = wrapToolExecute('t', async () => '', { onError });
    expect(await wrapped({}, {})).toContain(FALLBACK_MARK);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ reason: 'empty' }));
  });

  it('SAD: undefined result becomes the fallback', async () => {
    const wrapped = wrapToolExecute('t', async () => undefined);
    expect(await wrapped({}, {})).toContain(FALLBACK_MARK);
  });

  it('HAPPY: a non-string object result is JSON-encoded', async () => {
    const wrapped = wrapToolExecute('t', async () => ({ ok: true }));
    expect(await wrapped({}, {})).toBe('{"ok":true}');
  });

  it('SAD: a hanging execute times out to the fallback (cannot freeze the turn)', async () => {
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

  it('respects a custom fallback string', async () => {
    const wrapped = wrapToolExecute('t', async () => '', { fallback: 'custom hold' });
    expect(await wrapped({}, {})).toBe('custom hold');
  });
});
