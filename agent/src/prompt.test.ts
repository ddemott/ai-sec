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
