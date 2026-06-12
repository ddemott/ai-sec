import { describe, it, expect } from 'vitest';
import { CallOutcomeTracker } from './callOutcome.js';

// WHO: the agent shutdown hook reading what happened on a call.
// WHAT: CallOutcomeTracker records booking (id + 'booked') / transfer ('transferred'),
//       defaulting to null so nothing is fabricated.
// WHEN: mutated by the booking/transfer tools mid-call, read at teardown.
// WHERE: agent/src/callOutcome.ts.
// WHY: this is what threads the call -> appointment link + outcome into
//      voice-session-end (the Calls tab was duration-only before).
describe('CallOutcomeTracker', () => {
  it('defaults to null outcome + null appointment (never fabricates)', () => {
    const t = new CallOutcomeTracker();
    expect(t.result()).toEqual({ outcome: null, appointmentId: null });
  });

  it('recordBooking sets outcome=booked + the appointment_id', () => {
    const t = new CallOutcomeTracker();
    t.recordBooking('11111111-2222-4333-8444-555555555555');
    expect(t.result()).toEqual({
      outcome: 'booked',
      appointmentId: '11111111-2222-4333-8444-555555555555',
    });
  });

  it('recordTransfer sets outcome=transferred', () => {
    const t = new CallOutcomeTracker();
    t.recordTransfer();
    expect(t.result()).toEqual({ outcome: 'transferred', appointmentId: null });
  });

  it('a later booking overrides an earlier (re-book on the same call)', () => {
    const t = new CallOutcomeTracker();
    t.recordBooking('aaaaaaaa-1111-4111-8111-111111111111');
    t.recordBooking('bbbbbbbb-2222-4222-8222-222222222222');
    expect(t.result().appointmentId).toBe('bbbbbbbb-2222-4222-8222-222222222222');
  });
});
