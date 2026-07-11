import { describe, it, expect } from 'vitest';
import { phonesWouldLoop } from '../../src/services/phoneLoopGuard';

describe('phonesWouldLoop', () => {
  // WHO: owner saving call-routing config. WHAT: detect a transfer target that
  // loops back into the AI. WHEN: on save. WHERE: backend guard + UI mirror.
  // WHY: forwarding "talk to a person" to the line that forwards INTO the AI
  // (or to the AI's own DID) makes the call loop forever.
  it('flags transfer == forwarded-from, any format', () => {
    expect(phonesWouldLoop('+16082175303', '608-217-5303', null)).toBe(true);
    expect(phonesWouldLoop('(608) 217-5303', '+16082175303', null)).toBe(true);
  });

  it('flags transfer == inbound DID', () => {
    expect(phonesWouldLoop('+16308229086', null, '6308229086')).toBe(true);
  });

  it('allows distinct numbers', () => {
    expect(phonesWouldLoop('+16308229086', '+16082175303', '+16305551234')).toBe(false);
  });

  it('no transfer number set → never loops', () => {
    expect(phonesWouldLoop(null, '+16082175303', '+16308229086')).toBe(false);
    expect(phonesWouldLoop('', '+16082175303', '+16308229086')).toBe(false);
  });

  it('ignores un-normalizable garbage (treated as no-match, not a false loop)', () => {
    expect(phonesWouldLoop('123', '+16082175303', null)).toBe(false);
  });
});
