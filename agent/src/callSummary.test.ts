import { describe, it, expect, vi, afterEach } from 'vitest';
import { summarizeCall } from './callSummary.js';

// WHO: the agent shutdown hook generating a post-call summary.
// WHAT: summarizeCall returns a short summary on success and NULL on every
//       failure mode, always within the timeout, never throwing.
// WHEN: once per call at teardown, awaited before voice-session-end.
// WHERE: agent/src/callSummary.ts.
// WHY: the summary must never be able to drop the working session-end write —
//      a flaky/slow OpenAI call has to degrade to "no summary", not an exception.
const KEY = 'sk-test-key';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('summarizeCall (failsafe post-call summary)', () => {
  it('returns null for an empty transcript without calling OpenAI', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect((await summarizeCall('   ', KEY)).summary).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null when no API key is provided', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect((await summarizeCall('Caller: hi', '')).summary).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the model summary on a 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '  Caller booked an oil change.  ' } }],
        }),
      }))
    );
    expect((await summarizeCall('Caller: I need an oil change.', KEY)).summary).toBe(
      'Caller booked an oil change.'
    );
  });

  it('returns null on a non-200 response (e.g. 429)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    );
    expect((await summarizeCall('Caller: hi', KEY)).summary).toBeNull();
  });

  it('returns null (never throws) when fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    await expect(summarizeCall('Caller: hi', KEY)).resolves.toEqual({ summary: null });
  });

  it('returns null when the model returns empty content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '' } }] }),
      }))
    );
    expect((await summarizeCall('Caller: hi', KEY)).summary).toBeNull();
  });
});
