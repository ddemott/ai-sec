import { describe, it, expect, vi, afterEach } from 'vitest';
import { classifyCallOutcome } from './callClassify.js';

// WHO: the agent shutdown hook classifying WHY a non-booking caller reached out.
// WHAT: classifyCallOutcome returns exactly one allowed category, or NULL on any
//       failure / when the model isn't confident — and never throws.
// WHEN: once per non-booking, non-transfer call at teardown.
// WHERE: agent/src/callClassify.ts.
// WHY: null is load-bearing — it leaves the outcome as 'no_outcome' server-side
//      (counted as abandoned), so we never paper over a genuinely-abandoned call.
const KEY = 'sk-test-key';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockReply(content: string, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => ({ choices: [{ message: { content } }] }) }))
  );
}

describe('classifyCallOutcome (failsafe WHY classifier)', () => {
  it('returns null for an empty transcript without calling OpenAI', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await classifyCallOutcome('  ', KEY)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null when no API key is provided', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await classifyCallOutcome('Caller: hi', '')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a valid category the model picks', async () => {
    mockReply('price');
    expect(await classifyCallOutcome('Caller: too expensive, never mind.', KEY)).toBe('price');
  });

  it('sanitizes case + punctuation to the allowed category', async () => {
    mockReply('No_Availability.');
    expect(await classifyCallOutcome('Caller: do you have Saturday?', KEY)).toBe('no_availability');
  });

  it('returns null for "unclear" (model declined to classify → stays abandoned)', async () => {
    mockReply('unclear');
    expect(await classifyCallOutcome('Caller: ...click', KEY)).toBeNull();
  });

  it('returns null for an out-of-vocabulary word', async () => {
    mockReply('banana');
    expect(await classifyCallOutcome('Caller: hi', KEY)).toBeNull();
  });

  it('returns null on a non-200 response', async () => {
    mockReply('price', false);
    expect(await classifyCallOutcome('Caller: hi', KEY)).toBeNull();
  });

  it('returns null (never throws) when fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    await expect(classifyCallOutcome('Caller: hi', KEY)).resolves.toBeNull();
  });
});
