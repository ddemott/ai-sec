/**
 * The phase map decides what the model can see, so its failure modes are
 * asymmetric and worth naming:
 *
 *   TOO MANY tools → the hallucination we are fixing (it narrates instead of
 *                    calling, or picks a tool that cannot work).
 *   TOO FEW  tools → a STRANDED CALLER. The model wants to do the right thing,
 *                    reaches for a tool that is not there, and the caller hears
 *                    dead air or an apology. That is GH #113, and it is worse
 *                    than the bug we are fixing, because the agent is trying.
 *
 * So these tests care most about the second kind: every phase must be able to
 * finish a real call, and every escape hatch must be reachable from everywhere.
 */
import { describe, it, expect } from 'vitest';
import { PHASE_TOOLS, PHASE_ROUTERS, toolsForPhase, type CallPhase } from './toolPhases.js';

const PHASES: CallPhase[] = ['intake', 'booking', 'manage'];

/** A fake tool map with every real tool name in it. */
const ALL_TOOLS = Object.fromEntries(
  [
    'start_booking',
    'manage_appointment',
    'get_customer_context',
    'get_detailed_customer_history',
    'find_caller_by_name',
    'identify_caller',
    'save_customer_preference',
    'send_verification_code',
    'verify_phone_code',
    'get_service_catalog',
    'get_company_policy_answer',
    'get_available_slots',
    'get_scheduling_options',
    'check_availability',
    'book_appointment',
    'book_with_scheduling',
    'record_sms_consent',
    'get_my_appointments',
    'cancel_appointment',
    'reschedule_appointment',
    'send_self_service_link',
    'take_message',
    'page_owner_via_sms',
    'capture_job_inquiry',
    'transfer_call',
  ].map((n) => [n, { name: n }])
);

describe('toolsForPhase — narrowing', () => {
  it('HAPPY: every phase is under the ceiling that breaks tool selection', () => {
    // WHY: OpenAI's function-calling guide says aim for <20 tools at the start of
    //      a turn; LiveKit's says 5-12. We were shipping 25 on every turn of every
    //      call. This assertion is what stops that creeping back — the regression
    //      would be silent and would look exactly like "the model got worse".
    //
    // 15 is a CEILING, not a target. intake is still the widest phase and still
    // above LiveKit's 5-12, because it is where the caller's intent is unknown and
    // every exit has to stay reachable — and a stranded caller is a worse bug than
    // a wide toolset (see the whole second describe block). In production it is
    // really 13: ENABLE_PHONE_VERIFICATION=false drops the two OTP tools, and
    // capabilities are applied BEFORE phases. Splitting intake further is the next
    // move, and it should be driven by an eval number, not by taste.
    for (const phase of PHASES) {
      const n = Object.keys(toolsForPhase(ALL_TOOLS, phase)).length;
      expect(n, `${phase} exposes ${n} tools`).toBeLessThanOrEqual(15);
    }
    // The phases that DO have a known intent must stay genuinely narrow — this is
    // where the ceiling is real and where the win is measurable.
    // 11/10: on 2026-07-16 the escape-hatch ROUTERS joined both working phases, and
    // send_self_service_link joined booking (manage already had it) — a wrong door
    // must never be a locked wing, and a complete intent must be satisfiable from
    // any working phase. Still inside LiveKit's published 5-12 comfort band, far
    // under OpenAI's <20.
    // 12 (booking): 2026-07-20 — capture_job_inquiry joined booking. The script's
    // canonical order is book FIRST, intake AFTER, so a "meeting about a job"
    // opener guarantees the model is in this phase when it reaches the intake
    // rung; with the tool only in 'intake' that rung was a locked wing (live sim
    // call: booked and closed with zero role questions asked).
    expect(Object.keys(toolsForPhase(ALL_TOOLS, 'booking')).length).toBeLessThanOrEqual(12);
    expect(Object.keys(toolsForPhase(ALL_TOOLS, 'manage')).length).toBeLessThanOrEqual(11);
  });

  it('SAD: a phase can never hand back a tool the session does not have', () => {
    // WHO: a tenant with ENABLE_PHONE_VERIFICATION=false (no OTP tools).
    // WHY: phases NARROW; they must never GRANT. If toolsForPhase unioned rather
    //      than intersected, a phase listing send_verification_code would resurrect
    //      a tool that capability-gating deliberately withheld — re-opening GH #113
    //      (the model calls a tool that does not exist → error → dead air), and
    //      silently defeating a SECURITY control from a routing table.
    const withoutOtp = { ...ALL_TOOLS } as Record<string, unknown>;
    delete withoutOtp.send_verification_code;
    delete withoutOtp.verify_phone_code;

    const intake = toolsForPhase(withoutOtp, 'intake');
    expect(intake).not.toHaveProperty('send_verification_code');
    expect(intake).not.toHaveProperty('verify_phone_code');
  });

  it('SAD: the calendar is NOT visible at intake — it cannot invent a time it never fetched', () => {
    // WHY: the 2026-07-13 call. The model said "I see that 3 PM is taken" on a
    //      completely empty calendar, having never called an availability tool.
    //      At intake it now has no tool that returns a time, so the only way to
    //      reach one is to call start_booking. It cannot talk its way there.
    const intake = toolsForPhase(ALL_TOOLS, 'intake');
    expect(intake).not.toHaveProperty('get_available_slots');
    expect(intake).not.toHaveProperty('get_scheduling_options');
    expect(intake).not.toHaveProperty('book_with_scheduling');
    // ...but the door is there, and it is a TOOL CALL, not a sentence.
    expect(intake).toHaveProperty('start_booking');
  });

  it('SAD: the traps that cause GH bug #3 are unreachable while booking', () => {
    // WHY: book_appointment and check_availability both need a resource_id that
    //      get_available_slots does not return. A model that reaches for either
    //      after get_available_slots produces a booking that fails validation —
    //      that is bug #3, and it is why the eval carries a regression case for it.
    //      Excluding them from the phase where the mistake is possible kills the
    //      class BY CONSTRUCTION instead of asking the model nicely.
    const booking = toolsForPhase(ALL_TOOLS, 'booking');
    expect(booking).not.toHaveProperty('book_appointment');
    expect(booking).not.toHaveProperty('check_availability');
    expect(booking).toHaveProperty('book_with_scheduling');
  });
});

describe('no phase can strand a caller', () => {
  it('SAD: take_message is reachable from EVERY phase', () => {
    // WHY: the pivot the prompt has always promised — "a booking attempt didn't
    //      work out and you switch to taking a message". If the booking phase
    //      could not take a message, a caller whose slot fell through would be
    //      stranded mid-call by the very machinery meant to make the agent more
    //      reliable. Narrowing must never remove an exit.
    for (const phase of PHASES) {
      expect(toolsForPhase(ALL_TOOLS, phase), phase).toHaveProperty('take_message');
    }
  });

  it('SAD: a human is reachable from EVERY phase', () => {
    // WHY: escalation is never off the table. (transfer_call is separately gated
    //      by the 'transfer' capability when no forward number is configured — so
    //      this asserts the phase map does not remove it, not that it always runs.)
    for (const phase of PHASES) {
      expect(toolsForPhase(ALL_TOOLS, phase), phase).toHaveProperty('transfer_call');
    }
  });

  it('SAD: a reschedule can still find a new time', () => {
    // WHY: "move my haircut to Thursday" needs an availability lookup, and the
    //      manage phase is where a reschedule happens. Omitting get_available_slots
    //      here would leave the model able to promise a move it cannot perform —
    //      which is precisely the lying-agent failure, reintroduced by a bad map.
    const manage = toolsForPhase(ALL_TOOLS, 'manage');
    expect(manage).toHaveProperty('get_available_slots');
    expect(manage).toHaveProperty('reschedule_appointment');
  });

  it('HAPPY: every tool the agent owns is reachable in at least one phase', () => {
    // WHY: a tool listed in NO phase is dead code that still costs a maintainer's
    //      attention, and — worse — a tool the prompt may still name, sending the
    //      model after something it can never reach. The two known-dead ones are
    //      excluded ON PURPOSE (see the bug #3 test above); everything else must
    //      have a home. This catches "we added a tool and forgot to route it".
    const INTENTIONALLY_UNREACHABLE = new Set(['book_appointment', 'check_availability']);
    const routed = new Set(PHASES.flatMap((p) => PHASE_TOOLS[p]));
    const orphans = Object.keys(ALL_TOOLS).filter(
      (n) => !routed.has(n) && !INTENTIONALLY_UNREACHABLE.has(n)
    );
    expect(orphans, `tools in no phase: ${orphans.join(', ')}`).toEqual([]);
  });
});

describe('routers', () => {
  it('HAPPY: each router targets a real phase, and lives in intake', () => {
    // WHY: a router that points at a phase that does not exist, or that is not
    //      visible where it must be called from, is a door painted on a wall.
    for (const [name, target] of Object.entries(PHASE_ROUTERS)) {
      expect(PHASES).toContain(target);
      expect(PHASE_TOOLS.intake).toContain(name);
    }
  });

  it('SAD: a wrong door is NEVER a locked wing — each working phase carries the opposite router', () => {
    // WHY (2026-07-16): neither working phase carried a router, so a caller who
    //      said "cancel my haircut" and tripped start_booking could never reach
    //      get_my_appointments — the eval caught the model looping
    //      get_available_slots ELEVEN times with no tool that could help. Same
    //      lesson as send_self_service_link in intake: narrowing must never
    //      remove an exit.
    expect(PHASE_TOOLS.booking).toContain('manage_appointment');
    expect(PHASE_TOOLS.manage).toContain('start_booking');
  });
});
