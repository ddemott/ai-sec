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
