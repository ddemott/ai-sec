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

  it('recordMessage sets outcome=message', () => {
    // WHO: Camille, 2026-07-25. WHAT: take_message wrote her message row, and the
    //      post-call LLM classifier still filed the call `wrong_service` (groceries
    //      are indeed not a service here — a true statement about a different
    //      question). WHY: what a tool DID outranks a guess about why they called.
    const t = new CallOutcomeTracker();
    t.recordMessage();
    expect(t.result()).toEqual({ outcome: 'message', appointmentId: null });
  });

  it('booking overrides a message taken earlier on the same call', () => {
    // A call that took a message and then booked is a BOOKED call; the message is
    // a detail of it.
    const t = new CallOutcomeTracker();
    t.recordMessage();
    t.recordBooking('cccccccc-3333-4333-8333-333333333333');
    expect(t.result()).toEqual({
      outcome: 'booked',
      appointmentId: 'cccccccc-3333-4333-8333-333333333333',
    });
  });

  it('a message taken AFTER a booking/transfer cannot demote it', () => {
    const booked = new CallOutcomeTracker();
    booked.recordBooking('dddddddd-4444-4444-8444-444444444444');
    booked.recordMessage();
    expect(booked.result().outcome).toBe('booked');
    // ...and the appointment link survives regardless.
    expect(booked.result().appointmentId).toBe('dddddddd-4444-4444-8444-444444444444');

    const transferred = new CallOutcomeTracker();
    transferred.recordTransfer();
    transferred.recordMessage();
    expect(transferred.result().outcome).toBe('transferred');
  });

  it('booked/transferred keep last-write-wins between themselves (unchanged)', () => {
    // Only 'message' is rank-limited. Booking→transfer stays last-write-wins so
    // this change alters nothing about calls that never take a message.
    const t = new CallOutcomeTracker();
    t.recordBooking('eeeeeeee-5555-4555-8555-555555555555');
    t.recordTransfer();
    expect(t.result().outcome).toBe('transferred');
    expect(t.result().appointmentId).toBe('eeeeeeee-5555-4555-8555-555555555555');
  });
});

describe('recordJobInquiry (the honest label for SCL_nRKo3KEVw8Yh)', () => {
  // WHY: capture_job_inquiry used to record NOTHING — the null fell to the
  // post-call classifier, which read the transcript's false "I'll leave a
  // message" and labelled the call 'message'. The Messages inbox was empty;
  // the lead sat unseen in job_inquiries.
  it('labels an unclassified call job_inquiry', () => {
    const t = new CallOutcomeTracker();
    t.recordJobInquiry();
    expect(t.result().outcome).toBe('job_inquiry');
  });

  it('outranks message — on a job call the inquiry row IS the message', () => {
    const t = new CallOutcomeTracker();
    t.recordMessage();
    t.recordJobInquiry();
    expect(t.result().outcome).toBe('job_inquiry');
  });

  it('a later message never downgrades it', () => {
    const t = new CallOutcomeTracker();
    t.recordJobInquiry();
    t.recordMessage();
    expect(t.result().outcome).toBe('job_inquiry');
  });

  it('never overwrites booked — the appointment is what the owner acts on', () => {
    const t = new CallOutcomeTracker();
    t.recordBooking('appt_1');
    t.recordJobInquiry();
    expect(t.result().outcome).toBe('booked');
    expect(t.result().appointmentId).toBe('appt_1');
  });

  it('never overwrites transferred', () => {
    const t = new CallOutcomeTracker();
    t.recordTransfer();
    t.recordJobInquiry();
    expect(t.result().outcome).toBe('transferred');
  });
});
