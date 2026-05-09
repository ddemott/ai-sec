/**
 * Tests for the system prompt builder. These assert on CONTENT the prompt
 * must contain, not exact wording — we don't want a reword to break the
 * test, but we do want regressions on critical behavior to get caught.
 */
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, formatDateForPrompt } from './prompt.js';

const BASE_CTX = {
  tenantName: 'DynaTire',
  callerPhone: '+15551234567',
  currentDate: 'Friday, April 24, 2026',
  timezone: 'America/Chicago',
};

describe('buildSystemPrompt', () => {
  it('HAPPY: injects tenant name and current date into the prompt', () => {
    // WHO: LiveKit agent boots a session for DynaTire
    // WHAT: The date-of-the-call + tenant-name must be present verbatim
    //        so the LLM has fresh context — BUG-061 was a stale date
    //        baked into the old Vapi prompt and we never recover that
    //        class of bug quietly
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toContain('DynaTire');
    expect(prompt).toContain('Friday, April 24, 2026');
    expect(prompt).toContain('America/Chicago');
  });

  it('HAPPY: caller-ID present → includes the phone with a verified-by-caller-ID note', () => {
    // WHO: Normal inbound call, caller-ID came through clean
    // WHAT: Prompt tells the LLM the phone is trusted so it can skip
    //        OTP and book directly when the caller asks
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toContain('+15551234567');
    expect(prompt).toContain('verified by caller ID');
    // WHY: The OTP script should NOT be the default path — only for
    //       anonymous callers. Prompt must not pre-require verification.
    expect(prompt).not.toContain('You MUST collect and verify');
  });

  it('HAPPY: anonymous caller → MUST-verify language is present', () => {
    // WHO: Caller with blocked/withheld caller-ID
    // WHAT: Prompt explicitly instructs the LLM to collect and OTP-verify
    //        a phone before any booking. Without this, the LLM might try
    //        to book with an empty phone and hit the gate confusingly.
    const prompt = buildSystemPrompt({ ...BASE_CTX, callerPhone: null });
    expect(prompt).toContain('NOT available');
    expect(prompt).toContain('MUST collect and verify');
  });

  it('HAPPY: phone verification section documents the OTP turn order', () => {
    // WHY: The LLM has to know the EXACT sequence (send code, read
    //       message, wait for caller to speak code, verify). If the
    //       section disappears in a refactor, the OTP feature is
    //       effectively dead even though the backend routes are live.
    const prompt = buildSystemPrompt({ ...BASE_CTX, callerPhone: null });
    expect(prompt).toContain('send_verification_code');
    expect(prompt).toContain('verify_phone_code');
    expect(prompt).toMatch(/VERBATIM/);
  });

  it('HAPPY: booking-error-code translations are documented', () => {
    // WHY: The backend returns error_code values (TIMESLOT_OCCUPIED,
    //        NO_SKILLED_EMPLOYEE, etc.) and the LLM must translate them
    //        to human speech. If the prompt drops these mappings, the
    //        agent starts saying "error code TIMESLOT_OCCUPIED" to
    //        callers — which has happened with prior prompt regressions.
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toContain('TIMESLOT_OCCUPIED');
    expect(prompt).toContain('NO_SKILLED_EMPLOYEE');
    expect(prompt).toContain('EMPLOYEE_NOT_SCHEDULED');
    expect(prompt).toContain('NO_AVAILABILITY');
  });

  it('HAPPY: mentions all 10 tools by name so the LLM knows its toolkit', () => {
    // WHY: If a tool name drifts here vs. the tool registry, the LLM
    //        may invoke the wrong name and the router 404s. Listing
    //        every tool in the prompt keeps this aligned.
    const prompt = buildSystemPrompt(BASE_CTX);
    for (const toolName of [
      'get_customer_context',
      'get_service_catalog',
      'get_available_slots',
      'get_scheduling_options',
      'check_availability',
      'book_appointment',
      'book_with_scheduling',
      'get_company_policy_answer',
      'send_verification_code',
      'verify_phone_code',
    ]) {
      expect(prompt).toContain(toolName);
    }
  });

  it('SAD: prompt forbids markdown and "as an AI" filler', () => {
    // WHY: Prior Vapi calls surfaced markdown bullet points spoken
    //        aloud (the TTS said "dash, tire rotation, dash, oil
    //        change..."). Prompt must explicitly reject that.
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toMatch(/no markdown/i);
    expect(prompt).toMatch(/no.*formatting/i);
    expect(prompt).toMatch(/no.*disclaimers/i);
  });

  it('HAPPY: availability-discipline section requires checking BEFORE booking', () => {
    // WHO: voice agent picking up a call where the caller wants to book
    // WHAT: prompt explicitly establishes that availability tools must
    //        run BEFORE booking tools, not in parallel and not skipped
    // WHEN: every booking conversation
    // WHERE: # Availability discipline section
    // WHY: pre-fix the agent would sometimes call book_appointment with
    //        a time it guessed from context — backend rejects with
    //        NO_AVAILABILITY, awkward "actually that's taken" follow-up
    //        on the phone. Prompt now mandates the check-first flow.
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toMatch(/Availability discipline/i);
    // Both check-availability tools called out as the gate before booking.
    expect(prompt).toMatch(/get_available_slots[\s\S]*get_scheduling_options[\s\S]*FIRST/i);
    // Sequence is explicit — caller asks → check → propose → book.
    expect(prompt).toMatch(/before.*booking|check.*before.*book/i);
  });

  it('HAPPY: next_available alternatives section instructs the agent to propose them aloud', () => {
    // WHO: agent that just called book_with_scheduling and got
    //        NO_AVAILABILITY back (or TIMESLOT_OCCUPIED), but the
    //        response included a next_available array
    // WHAT: prompt tells the agent to read those alternatives to the
    //        caller verbally instead of asking "what other time?"
    // WHEN: any failed booking attempt where alternatives are present
    // WHERE: # When a booking response includes next_available section
    // WHY: shipping the next_available data plumbing (commits e2cf4a9 +
    //        ba8cc43) provides the alternatives, but without prompt
    //        guidance the agent ignores the array and falls back to the
    //        old "want to pick another time?" line — feature has zero
    //        runtime impact until this section exists.
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toMatch(/next_available/);
    // Includes a concrete usage example — pre-formatted slot → spoken line.
    expect(prompt).toMatch(/employee_name/);
    // Empty-array fallback is documented so the agent knows when to
    // revert to the old "pick another time" behavior.
    expect(prompt).toMatch(/empty.*missing|missing.*empty/i);
  });

  it('HAPPY: NO_AVAILABILITY mapping references next_available rather than just "pick another time"', () => {
    // WHY: pin the explicit linkage between the error code and the
    //        alternatives surface — if a refactor breaks the mapping
    //        the agent reverts to the generic line and the new feature
    //        silently dies in production.
    const prompt = buildSystemPrompt(BASE_CTX);
    // The NO_AVAILABILITY mapping must reference next_available so the
    // agent knows to read those alternatives before falling back.
    const noAvailIdx = prompt.indexOf('NO_AVAILABILITY');
    expect(noAvailIdx).toBeGreaterThan(-1);
    // Within the next 200 chars after NO_AVAILABILITY, next_available
    // must appear — keeps the mapping concrete and findable for the LLM.
    const slice = prompt.slice(noAvailIdx, noAvailIdx + 300);
    expect(slice).toMatch(/next_available/);
  });

  // ── AI-prevention conversation-shape tests (booking enforcement Slice 4) ──
  // These pin the four rules the prompt establishes for the agent's
  // tool-call ordering + fallback behavior. They don't run an LLM (cost +
  // determinism); they pin the prompt content the agent reads from. If the
  // prompt loses any of these rules in a refactor, the LLM has license to
  // skip the check, propose off-grid times, or strand the caller — every
  // failure mode the booking-enforcement chain was meant to prevent.

  it('CONVERSATION-SHAPE (a): prompt mandates check-before-book as a HARD RULE, not a hint', () => {
    // WHO: voice agent picking up a call where the caller wants to book
    // WHAT: prompt establishes that an availability tool MUST run before
    //        any booking tool — strong language ("MUST", "hard rule",
    //        "before every"), not soft language ("usually", "try to")
    // WHEN: every booking conversation — without exception
    // WHERE: # Availability discipline section
    // WHY: pre-tightening the prompt said "the booking tools enforce this
    //        server-side" which gave the LLM license to skip the check
    //        and let the backend catch it — but by the time the backend
    //        rejects, the caller has already heard a time the agent
    //        couldn't deliver. The hard rule prevents that.
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toMatch(/hard rule/i);
    expect(prompt).toMatch(/MUST call an availability tool BEFORE/);
    // All three availability tools called out so the LLM knows it has
    // multiple paths into the gate (different tools fit different shapes
    // of caller request).
    expect(prompt).toMatch(/get_available_slots/);
    expect(prompt).toMatch(/get_scheduling_options/);
    expect(prompt).toMatch(/check_availability/);
    // Pin the warning against the old "backend will catch it" excuse.
    expect(prompt).toMatch(/Don't rely on the backend|don't rely on the backend/i);
  });

  it('CONVERSATION-SHAPE (b): on TIMESLOT_OCCUPIED, prompt directs propose-alternative not retry', () => {
    // WHO: agent that just got a TIMESLOT_OCCUPIED back from book_appointment
    // WHAT: prompt tells the agent to (1) acknowledge "that time just got
    //        taken", (2) propose alternatives from next_available if
    //        present, NOT to retry the same slot or guess a new one
    // WHEN: any booking response with TIMESLOT_OCCUPIED + a populated
    //        conflict block / next_available array
    // WHERE: # Booking rules + # When a booking response includes next_available
    // WHY: without this, the agent might just say "sorry that's taken,
    //        what other time?" — putting the work back on the caller.
    //        The conflict response carries enough info for the agent to
    //        proactively offer alternatives.
    const prompt = buildSystemPrompt(BASE_CTX);
    // TIMESLOT_OCCUPIED mapping must reference proposing alternatives.
    const timeslotIdx = prompt.indexOf('TIMESLOT_OCCUPIED');
    expect(timeslotIdx).toBeGreaterThan(-1);
    // Within the next ~250 chars after the code, "alternatives" or
    // "next_available" must appear so the LLM knows to look there.
    const slice = prompt.slice(timeslotIdx, timeslotIdx + 250);
    expect(slice).toMatch(/alternatives|next_available/i);
    // The user-friendly translation must NOT include the raw code.
    expect(slice).toMatch(/that time just got taken|just got taken/i);
  });

  it('CONVERSATION-SHAPE (c): prompt requires 15-minute grid times in the agent\'s spoken proposals', () => {
    // WHO: agent reading back times to a caller after an availability tool
    //        returned slots
    // WHAT: prompt explicitly tells the agent every spoken time must land
    //        on the 15-min clock grid (:00, :15, :30, :45) — not :07,
    //        :23, :40 etc. — because the system rejects off-grid times
    //        at booking time.
    // WHEN: any time the agent verbalizes a candidate slot to the caller
    // WHERE: # Availability discipline section, the proposal step
    // WHY: pre-rule, the agent could rephrase a returned slot ("I have
    //        2:07") which would then fail at book_appointment with
    //        INVALID_INCREMENT, forcing an awkward correction. Pinning
    //        the grid in the prompt closes that gap before the booking
    //        call happens.
    const prompt = buildSystemPrompt(BASE_CTX);
    // The four grid minute values must appear together as the canonical
    // set so the LLM can match against them.
    expect(prompt).toMatch(/:00, :15, :30, :45/);
    // Forbidden examples must appear so the rule has teeth ("never X").
    expect(prompt).toMatch(/never :07|never :07,|:07/);
    // "15-minute" or "grid" must appear as the conceptual label.
    expect(prompt).toMatch(/15-minute|15 minute|clock grid/i);
  });

  it('CONVERSATION-SHAPE (d): when nothing fits, prompt directs the agent to take a message gracefully', () => {
    // WHO: agent that has cycled through next_available + get_scheduling_options
    //        and the caller has rejected every alternative
    // WHAT: prompt tells the agent to STOP guessing and offer to take a
    //        message — capturing name + reason — instead of looping back
    //        to "want another time?" indefinitely
    // WHEN: caller has rejected every available slot, or a tool returned
    //        zero slots and there's no point trying further
    // WHERE: # When the caller can't be accommodated section
    // WHY: without this, the agent's natural fallback ("any other time
    //        work for you?") creates infinite loops on phones with no
    //        real availability. The take-a-message path is the graceful
    //        exit that keeps the lead alive without booking a doomed slot.
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toMatch(/take a message/i);
    // The exhaustion condition must be documented so the LLM knows when
    // to escalate vs. keep trying.
    expect(prompt).toMatch(/rejected all|rejected every|zero slots|nothing.*lines up/i);
    // Capture rules: name + reason. Pre-rule the agent might forget to
    // ask for the reason, leaving the call summary ambiguous.
    expect(prompt).toMatch(/name.*reason|reason.*name/i);
    // Don't-promise-a-specific-callback rule — preserves trust.
    expect(prompt).toMatch(/don't promise|do not promise/i);
  });
});

describe('formatDateForPrompt', () => {
  it('HAPPY: renders a full weekday+month+day+year string in the tenant timezone', () => {
    // WHO: Scheduler said "book me Tuesday" — the LLM needs to know
    //        today to compute Tuesday's date
    const date = new Date('2026-04-24T17:30:00Z'); // 12:30 PM CDT
    expect(formatDateForPrompt(date, 'America/Chicago')).toBe(
      'Friday, April 24, 2026'
    );
  });

  it('HAPPY: different timezone across a date boundary yields different dates', () => {
    // WHY: Prior bug: we used UTC date for all tenants, so a tenant in
    //        Hawaii saw "tomorrow's" date at 10 PM local. Using the
    //        tenant's IANA zone is the correct fix.
    const lateUTC = new Date('2026-04-24T05:00:00Z'); // 10 PM the 23rd in HST
    expect(formatDateForPrompt(lateUTC, 'Pacific/Honolulu')).toContain('April 23');
    expect(formatDateForPrompt(lateUTC, 'America/New_York')).toContain('April 24');
  });
});
