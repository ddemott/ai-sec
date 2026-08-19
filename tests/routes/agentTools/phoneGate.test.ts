/**
 * The booking phone gate's SPOKEN refusal.
 *
 * WHO: a caller who has just named a time | WHAT: the sentence the agent relays
 * when it has no dialable number | WHEN: every booking attempt that fails the
 * gate | WHERE: src/routes/agentTools/scheduling.ts | WHY: on 2026-08-15
 * (sim-call-1786818806598) the caller said "Can we do it after lunch? Like,
 * maybe at one?", the model tried to book 1:00 PM, this gate refused it, and the
 * model relayed only the refusal — "The number I have seems not to work for
 * confirming the appointment". The time he asked for vanished from the
 * conversation and he had to ask again two minutes later.
 */
import { describe, it, expect } from 'vitest';

import { phoneGateMessage, spokenLocalTime } from '../../../src/routes/agentTools/scheduling';

describe('spokenLocalTime', () => {
  it('HAPPY: reads the wall clock the agent sent, without inventing a timezone', () => {
    // The agent sends local-naive wall clock. Constructing a Date here would
    // re-interpret it in the SERVER's zone — the exact class of bug that once
    // offered a caller afternoon slots that had already passed.
    expect(spokenLocalTime('2026-08-17T13:00:00')).toBe('1:00 PM');
    expect(spokenLocalTime('2026-08-17T09:30:00')).toBe('9:30 AM');
    expect(spokenLocalTime('2026-08-17T00:15:00')).toBe('12:15 AM');
    expect(spokenLocalTime('2026-08-17T12:00:00')).toBe('12:00 PM');
  });

  it('SAD: anything unparseable yields null rather than a guess', () => {
    expect(spokenLocalTime(undefined)).toBeNull();
    expect(spokenLocalTime(null)).toBeNull();
    expect(spokenLocalTime('')).toBeNull();
    expect(spokenLocalTime('2026-08-17')).toBeNull();
    expect(spokenLocalTime('tomorrow afternoon')).toBeNull();
    expect(spokenLocalTime('2026-08-17T99:00:00')).toBeNull();
    expect(spokenLocalTime('2026-08-17T13:99:00')).toBeNull();
  });
});

describe('phoneGateMessage', () => {
  it('HAPPY: holds the time the caller asked for, then asks for the number', () => {
    const msg = phoneGateMessage('2026-08-17T13:00:00');

    expect(msg).toContain('I can hold 1:00 PM');
    expect(msg).toContain('phone number');
  });

  it('never offers to text — this platform cannot send one', () => {
    // WHY: the old wording asked for "the best number to text or call". On the
    //      2026-08-15 call the agent asked exactly that and then, one turn
    //      later, had to admit "I can't send a text from this line right now".
    //      SMS is off platform-wide until 10DLC; do not offer what we cannot do.
    expect(phoneGateMessage('2026-08-17T13:00:00')).not.toMatch(/text/i);
    expect(phoneGateMessage(null)).not.toMatch(/text/i);
  });

  it('SAD: with no usable time it still asks cleanly, with no dangling clause', () => {
    const msg = phoneGateMessage(undefined);

    expect(msg).not.toContain('hold');
    expect(msg.startsWith('Before I book')).toBe(true);
  });
});
