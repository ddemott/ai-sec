/**
 * The point of composing scripts from blocks is that the LESSONS cannot be lost.
 *
 * Every universal rung here was paid for by a real call that went wrong: the read-back
 * that has to end the turn, the phone number that arrives in pieces, the booking that
 * must happen BEFORE the questions, the "is there anything else?" that closes a call
 * with the caller's actual request still undone.
 *
 * A second business must inherit all of that for free. So these tests are less about
 * the composer working and more about the invariants it exists to protect — the ones a
 * copy-pasted script would quietly lose.
 */
import { describe, it, expect } from 'vitest';
import {
  BLOCKS,
  CANONICAL_ORDER,
  composeScript,
  INTAKE_JOB_INQUIRY,
  INTAKE_REAL_ESTATE,
} from '../../src/services/scripts/blocks';

const PERSONA = 'You are the receptionist for Acme.';

describe('script composition — the invariants a copy-pasted script would lose', () => {
  it('SAD: intake can NEVER come before the booking', () => {
    // WHY: the single worst failure of the week, twice over. A caller asked for a
    //      meeting, answered nine questions about the job, and hung up with NOTHING IN
    //      THE DIARY. The notes were flawless. The call was a failure.
    //
    //      A tenant chooses their INTAKE questions. They do not get to choose whether
    //      the meeting is booked first — that is not a preference, it is what those
    //      calls taught us. The composer places blocks in CANONICAL_ORDER, so this
    //      cannot be got wrong by a config, only by editing this file on purpose.
    const script = composeScript({ persona: PERSONA, intake: ['intake_job_inquiry'] });

    const bookAt = script.indexOf('BOOK IT FIRST');
    const intakeAt = script.indexOf('What company are you calling from?');
    expect(bookAt).toBeGreaterThan(-1);
    expect(intakeAt).toBeGreaterThan(-1);
    expect(bookAt, 'the booking rung must come before any intake question').toBeLessThan(intakeAt);
  });

  it('SAD: every script confirms the phone number and WAITS', () => {
    // WHY: "You never let me answer if it was right or not. You just went on
    //      immediately." — a real caller, mid-call, 2026-07-14. The agent read his
    //      number back and acted on it before he could say yes.
    //      A new business must not have to rediscover that.
    for (const intake of [['intake_job_inquiry'], ['intake_real_estate'], []]) {
      const script = composeScript({ persona: PERSONA, intake });
      expect(script).toContain('STOP TALKING');
      expect(script).toMatch(/read it back/i);
      expect(script).toMatch(/never proceed on a number they did not confirm/i);
    }
  });

  it('SAD: every script forbids closing on an unfinished ask', () => {
    // WHY: "Is there anything else I can help you with?" is how the agent ended a call
    //      with the caller's own request undone. It sounds like service. It is an exit.
    for (const intake of [['intake_job_inquiry'], ['intake_real_estate']]) {
      const script = composeScript({ persona: PERSONA, intake });
      expect(script).toMatch(/is there anything else/i);
      expect(script).toMatch(/it is not a way out/i);
    }
  });

  it('HAPPY: two verticals share every universal rung and differ ONLY in intake', () => {
    // WHY: this IS the feature. A staffing agency and an estate agent are the same call
    //      with different questions in the middle. If they diverge anywhere else, the
    //      abstraction has failed and we are back to maintaining N scripts by hand.
    const staffing = composeScript({ persona: PERSONA, intake: ['intake_job_inquiry'] });
    const realEstate = composeScript({ persona: PERSONA, intake: ['intake_real_estate'] });

    for (const universal of [
      'ladder_header',
      'identity',
      'book_meeting',
      'complete_all_goals',
      'close',
    ]) {
      expect(staffing).toContain(BLOCKS[universal].text);
      expect(realEstate).toContain(BLOCKS[universal].text);
    }

    // ...and the only difference is the middle.
    expect(staffing).toContain(INTAKE_JOB_INQUIRY.text);
    expect(staffing).not.toContain(INTAKE_REAL_ESTATE.text);
    expect(realEstate).toContain(INTAKE_REAL_ESTATE.text);
    expect(realEstate).not.toContain(INTAKE_JOB_INQUIRY.text);
  });

  it('HAPPY: a business that fits no existing block can supply its own intake inline', () => {
    // WHY: "I may have multiple real estates with slightly different structures." The
    //      long tail must not require a code change — otherwise the next business waits
    //      on a deploy, and someone pastes a script into the database by hand instead,
    //      which is exactly what this module exists to stop.
    const script = composeScript({
      persona: PERSONA,
      customIntake: '### RUNG 3 — ASK ABOUT THE DOG\n\nIF they have a dog → what breed?',
    });
    expect(script).toContain('ASK ABOUT THE DOG');
    // Still wrapped in every universal rung, in order.
    expect(script.indexOf('BOOK IT FIRST')).toBeLessThan(script.indexOf('ASK ABOUT THE DOG'));
    expect(script.indexOf('ASK ABOUT THE DOG')).toBeLessThan(script.indexOf('IS EVERY GOAL'));
  });

  it('HAPPY: a script with NO intake is still a complete, valid call', () => {
    // WHY: a salon does not interview anybody. It books, and that is the whole call.
    const script = composeScript({ persona: PERSONA });
    expect(script).toContain('BOOK IT FIRST');
    expect(script).toContain('IS EVERY GOAL');
    expect(script.startsWith(PERSONA)).toBe(true);
  });

  it('SAD: an unknown intake id fails LOUDLY, at compose time', () => {
    // WHY: a typo'd block id must not silently produce a script with a hole in it. The
    //      agent would run a call missing an entire rung and nothing would look wrong.
    expect(() => composeScript({ persona: PERSONA, intake: ['intake_dentistry'] })).toThrow(
      /Unknown intake block/
    );
  });

  it('SAD: the real-estate script NEVER values a home, and screens for another agent', () => {
    // WHO: a seller, ringing a listing agent. This is the money call in real estate and
    //      it has two traps in it, both of which a naive script walks straight into.
    //
    // TRAP 1 — "what's my house worth?" A number given on the phone is anchored to,
    //      certainly wrong (nobody has seen the house), and it destroys the entire
    //      reason for the listing appointment. The honest answer IS the appointment.
    //
    // TRAP 2 — the property is already listed with ANOTHER BROKERAGE. Soliciting that
    //      seller is an ethics violation and in many states a licence matter. It has to
    //      be asked FIRST, and a "yes" must END the call, not just annotate it.
    //
    // Both are the kind of thing a business owner assumes their receptionist knows and
    // never thinks to write down — which is exactly why it belongs in a shared block
    // rather than in one tenant's hand-typed prompt.
    const script = composeScript({ persona: PERSONA, intake: ['intake_real_estate'] });

    expect(script).toMatch(/NEVER put a value on someone's home/i);
    expect(script).toMatch(/listed with another agent/i);
    expect(script).toMatch(/ethics violation/i);
    // ...and the asking price of OUR OWN listing is public — the rule is about opinions
    // of value, not about refusing to speak. A script that cannot quote its own listing
    // is useless to the business.
    expect(script).toMatch(/ASKING PRICE.*is public/i);
    // Never advise on financing.
    expect(script).toMatch(/never advise on mortgages/i);
  });

  it('HAPPY: the real-estate script routes every caller a real agency actually gets', () => {
    // WHY: a real estate line is not just buyers and sellers. It is other AGENTS wanting
    //      showing access or submitting an offer (time-critical — a slow answer loses a
    //      sale), clients mid-transaction who must NOT be run through a lead-intake
    //      script, and tenants of managed properties whose "no heat" call is an emergency
    //      and not a message. Miss a branch and that caller gets the wrong call entirely.
    const script = composeScript({ persona: PERSONA, intake: ['intake_real_estate'] });

    expect(script).toMatch(/THEY ARE SELLING/i);
    expect(script).toMatch(/THEY ARE BUYING/i);
    expect(script).toMatch(/ONE OF OUR LISTINGS/i);
    expect(script).toMatch(/ANOTHER AGENT/i);
    expect(script).toMatch(/EXISTING CLIENT, MID-TRANSACTION/i);
    expect(script).toMatch(/A TENANT/i);

    // The two that must ESCALATE rather than take a polite message.
    expect(script).toMatch(/SUBMITTING AN OFFER[\s\S]{0,200}Page the agent/i);
    expect(script).toMatch(/EMERGENCY[\s\S]{0,160}page the owner NOW/i);
  });

  it('HAPPY: every block in CANONICAL_ORDER actually exists', () => {
    for (const id of CANONICAL_ORDER) {
      expect(BLOCKS[id], `CANONICAL_ORDER names a block that does not exist: ${id}`).toBeDefined();
    }
  });
});
