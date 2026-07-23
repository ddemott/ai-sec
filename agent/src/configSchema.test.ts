import { describe, it, expect } from 'vitest';
import { envSchema } from './configSchema.js';

// A minimal valid env so the schema parses; we then probe individual defaults.
// The schema is importable with no side effects BY DESIGN (see its header) —
// that is the whole reason it was split from config.ts, so defaults are testable.
const BASE = {
  LIVEKIT_URL: 'wss://x.livekit.cloud',
  LIVEKIT_API_KEY: 'k',
  LIVEKIT_API_SECRET: 's',
  AGENT_SECRET: 'a'.repeat(32),
  BACKEND_URL: 'https://backend.test',
  OPENAI_API_KEY: 'o',
  DEEPGRAM_API_KEY: 'd',
};

describe('envSchema — PARTICIPANT_WAIT_MS (ghost-dispatch guard window)', () => {
  it('defaults to 20000ms when unset', () => {
    const cfg = envSchema.parse({ ...BASE });
    expect(cfg.PARTICIPANT_WAIT_MS).toBe(20000);
  });

  it('honors a valid in-range value', () => {
    expect(envSchema.parse({ ...BASE, PARTICIPANT_WAIT_MS: '30000' }).PARTICIPANT_WAIT_MS).toBe(
      30000
    );
  });

  it('falls back to the default for out-of-range or garbage', () => {
    for (const bad of ['0', '999', '600000', 'abc', '', '   ']) {
      expect(envSchema.parse({ ...BASE, PARTICIPANT_WAIT_MS: bad }).PARTICIPANT_WAIT_MS).toBe(
        20000
      );
    }
  });
});
