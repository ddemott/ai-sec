/**
 * WHO: inbound caller, the instant the leg is up.
 * WHAT: we do not wait after pickup for TTS cache.
 * WHEN: 2026-08-14 — 12s post-pickup wait was dead air; Dale: "would you
 *       wait 3 seconds before answering?"
 * WHERE: greetingPickup.ts, consumed by index.ts say().
 * WHY: a prompt/cap that delays first audio after answer is the pause.
 */
import { describe, expect, it } from 'vitest';
import {
  GREETING_POST_PICKUP_WAIT_MS,
  auraTtsStreamingEnabled,
  canWarmGreetingBeforePickup,
  greetingSpeakPath,
} from './greetingPickup.js';

describe('greeting pickup', () => {
  it('does not wait after the caller is on the line', () => {
    expect(GREETING_POST_PICKUP_WAIT_MS).toBe(0);
  });

  it('plays cache if the ring-time warm landed; otherwise speaks live NOW', () => {
    expect(greetingSpeakPath(true)).toBe('play_cache');
    expect(greetingSpeakPath(false)).toBe('speak_live');
  });

  it('can start the greeting warm from dispatch tenant_id — before pickup', () => {
    expect(canWarmGreetingBeforePickup('d5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0')).toBe(true);
    expect(canWarmGreetingBeforePickup('')).toBe(false);
    expect(canWarmGreetingBeforePickup(null)).toBe(false);
  });

  it('AURA_TTS_STREAMING=false turns the silent WS path off', () => {
    const prev = process.env.AURA_TTS_STREAMING;
    process.env.AURA_TTS_STREAMING = 'false';
    expect(auraTtsStreamingEnabled()).toBe(false);
    if (prev === undefined) delete process.env.AURA_TTS_STREAMING;
    else process.env.AURA_TTS_STREAMING = prev;
  });
});
