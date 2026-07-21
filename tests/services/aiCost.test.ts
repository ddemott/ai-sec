/**
 * Unit tests for estimateCost — the token→USD map behind ai_cost_events.
 *
 * Origin (2026-07-21): the PRICING map was MISSING gpt-4.1-mini, the production
 * voice LLM. estimateCost fell through to {input:0, output:0}, so 77-83% of
 * every call's real cost (all gpt-4.1-mini input tokens) recorded as $0.00 —
 * the ledger reported the business was nearly free while the real bill was
 * ~$0.06/call. These tests pin every model the app actually invokes so a
 * missing rate can never again masquerade as "free".
 */
import { describe, it, expect } from 'vitest';
import { estimateCost } from '../../src/services/aiCost.js';

describe('estimateCost — every model the app invokes has a nonzero rate', () => {
  // WHY: a model with no PRICING entry silently costs $0 — the exact regression
  // that hid the voice LLM's entire cost. If we call it, it must be priced.
  it.each([
    ['gpt-4.1-mini', 1_000_000, 1_000_000], // production voice LLM
    ['gpt-4.1-nano', 1_000_000, 1_000_000], // cost-down candidate
    ['gpt-4o-mini', 1_000_000, 1_000_000], // summaries / classify
    ['text-embedding-3-small', 1_000_000, 0],
  ])('%s costs more than zero for real token volume', (model, inTok, outTok) => {
    const cost = estimateCost({ provider: 'openai', model, inputTokens: inTok, outputTokens: outTok });
    expect(cost).toBeGreaterThan(0);
  });

  it('gpt-4.1-mini is priced at 4x nano input — the cost-down lever is real', () => {
    const mini = estimateCost({ provider: 'openai', model: 'gpt-4.1-mini', inputTokens: 1_000_000 });
    const nano = estimateCost({ provider: 'openai', model: 'gpt-4.1-nano', inputTokens: 1_000_000 });
    expect(mini).toBeCloseTo(0.4, 6);
    expect(nano).toBeCloseTo(0.1, 6);
    expect(mini / nano).toBeCloseTo(4, 5);
  });

  it("a heavy real call's token profile lands in the right ballpark (~$0.14 LLM)", () => {
    // The 2026-07-21 352k-input / 1061-output call, gpt-4.1-mini.
    const cost = estimateCost({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      inputTokens: 352_035,
      outputTokens: 1061,
    });
    expect(cost).toBeGreaterThan(0.13);
    expect(cost).toBeLessThan(0.16);
  });

  it('Deepgram STT (nova-3) is costed by AUDIO regardless of provider casing', () => {
    // The old check keyed on provider==="deepgram" and missed "Deepgram" rows.
    const lower = estimateCost({ provider: 'deepgram', model: 'nova-3', audioDurationMs: 180_000 });
    const upper = estimateCost({ provider: 'Deepgram', model: 'nova-3', audioDurationMs: 180_000 });
    expect(lower).toBeGreaterThan(0);
    expect(upper).toBe(lower); // casing must not change the cost
  });

  it('Deepgram Aura TTS is costed by CHARACTERS (was $0 — never priced before)', () => {
    const cost = estimateCost({ provider: 'Deepgram', model: 'aura-luna-en', charactersCount: 1000 });
    expect(cost).toBeCloseTo(0.015, 6);
  });

  it('an unknown model still returns 0 (no crash) — but that is the gap to watch', () => {
    expect(estimateCost({ provider: 'openai', model: 'gpt-9-imaginary', inputTokens: 1000 })).toBe(0);
  });
});
