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

  it('HAPPY: instructs the agent to offer the service menu, not ask blind', () => {
    // WHO: Caller wants to book but Beth previously asked "what service?"
    //       without listing the options, so the caller couldn't answer.
    // WHAT: The prompt must tell the agent to call get_service_catalog FIRST
    //        and read the real options back, plus offer to take a message.
    // WHY: An open-ended "which service?" with no menu is a dead end — the
    //        caller can't guess what's on offer. Fix lives in the prompt.
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toContain('get_service_catalog');
    expect(prompt).toMatch(/never ask an open-ended/i);
    expect(prompt).toMatch(/take a message/i);
  });

  it('HAPPY: instructs the agent to read back a phone number + never go silent on partial input', () => {
    // WHO: a caller whose spoken number came through partial (STT split/dropped
    //       digits), e.g. only 6 of 10 captured.
    // WHAT: the prompt must tell the agent to read the number back, ask for the
    //        missing digits when it has fewer than 10, and ALWAYS respond rather
    //        than wait silently.
    // WHY: Beth was stalling after an incomplete number (dead air = "frozen
    //        call"). The fix is prompt guidance to confirm/re-prompt, never hang.
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toMatch(/read it back|read back/i);
    expect(prompt).toMatch(/10 digits/i);
    expect(prompt).toMatch(/never (go silent|leave dead air)/i);
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

  it('HAPPY: infrastructure-error guidance is documented (no raw technical text to callers)', () => {
    // WHY: 2026-05-21 — domain error codes had a translation table but
    //        INFRASTRUCTURE failures (a backend 500 / tool timeout) did not.
    //        The LLM would receive raw "Backend returned 500" / "timed out"
    //        text with no instruction and could read it aloud or improvise.
    //        This pins the technical-glitch section so a future prompt edit
    //        can't silently drop graceful recovery and re-expose callers to
    //        raw error strings (or dead air).
    const prompt = buildSystemPrompt(BASE_CTX);
    // The section names the technical signatures it must NOT speak aloud...
    expect(prompt).toContain('Backend returned 500');
    expect(prompt).toContain('timed out');
    // ...and instructs graceful, in-character recovery instead.
    expect(prompt).toContain('NEVER read the technical error text aloud');
    expect(prompt.toLowerCase()).toContain('take your name and number');
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
      'transfer_call',
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

  it("CONVERSATION-SHAPE (c): prompt requires 15-minute grid times in the agent's spoken proposals", () => {
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
    expect(prompt).toMatch(/run out|turned down several|searches come back empty|zero slots/i);
    // Customer-led booking (2026-06-06): when the offered times don't work
    // the agent must WIDEN the search and offer the next set, not jump
    // straight to a message. Pin both halves so a reword can't drop the loop.
    expect(prompt).toMatch(/do NOT jump to taking a message|widen, don't give up/i);
    expect(prompt).toMatch(/next set of open times|NEXT window/i);
    // Capture rules: name + reason. Pre-rule the agent might forget to
    // ask for the reason, leaving the call summary ambiguous.
    expect(prompt).toMatch(/name.*reason|reason.*name/i);
    // Don't-promise-a-specific-callback rule — preserves trust.
    expect(prompt).toMatch(/don't promise|do not promise/i);
  });

  it('CONVERSATION-SHAPE (e): booking is customer-led — ask the caller their time, never impose', () => {
    // WHO: any caller who hasn't already volunteered a specific day/time.
    // WHAT: the prompt directs the agent to ASK what works for the caller and
    //        states plainly that the caller chooses the time, not the agent.
    // WHEN: the start of every booking flow.
    // WHERE: # Availability discipline section.
    // WHY: 2026-06-06 feedback — an agent that announces a slot it picked
    //      ("you're booked at 2") treats the caller's day as filler for the
    //      shop's gaps. The caller's time is theirs; the agent fits the shop
    //      around it, asking politely and offering options to choose from.
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).toMatch(/caller chooses the time/i);
    expect(prompt).toMatch(/what day and time work for THEM|what day were you thinking/i);
    expect(prompt).toMatch(/never (announce|impose)|don't (assume|impose)/i);
  });

  // ───────────────────────────────────────────────────────────────────
  // Custom system prompt (2026-05-18): tenants.system_prompt overrides
  // the hardcoded "You are Clara..." identity line. Placeholders get
  // substituted from PromptContext fields. Everything else (tools, OTP,
  // booking discipline) stays platform-controlled.
  // ───────────────────────────────────────────────────────────────────

  it('CUSTOM PROMPT: when set, replaces the hardcoded Clara line as the identity section', () => {
    // WHO: tenant whose AI Persona page in the dashboard says "You are
    //      a friendly virtual receptionist for {{business_name}}..."
    // WHAT: that text appears at the top of the prompt verbatim (minus
    //      the substituted placeholder); the default Clara line does NOT.
    // WHERE: agent/src/prompt.ts buildSystemPrompt identity branch.
    // WHY: pre-2026-05-18 the dashboard customization was dead weight —
    //      the agent built its own prompt and ignored the DB column.
    const prompt = buildSystemPrompt({
      ...BASE_CTX,
      customPrompt: 'You are a friendly virtual receptionist for {{business_name}}.',
    });
    expect(prompt).toContain('You are a friendly virtual receptionist for DynaTire.');
    expect(prompt).not.toContain('You are Clara, the AI receptionist');
  });

  it('CUSTOM PROMPT: platform-level sections (tools, OTP, booking) still appear below the custom identity', () => {
    // WHY: customization is for the persona only. Booking discipline +
    //      tool listings are load-bearing for correctness and must NOT
    //      be replaceable by a tenant who edits their persona.
    const prompt = buildSystemPrompt({
      ...BASE_CTX,
      customPrompt: 'Custom persona text.',
    });
    expect(prompt).toContain('# Conversation style');
    expect(prompt).toContain('# Available tools');
    expect(prompt).toContain('# Phone Verification');
    expect(prompt).toContain('get_company_policy_answer');
    expect(prompt).toContain('TIMESLOT_OCCUPIED');
  });

  it('CUSTOM PROMPT: substitutes {{business_name}}, {{current_date}}, {{caller_phone}}', () => {
    // WHAT: all three Handlebars placeholders supported at prompt build time.
    // WHY: the DB-stored templates use these exact tokens (see
    //      supabase/baseline.sql seeded answering-service template).
    const prompt = buildSystemPrompt({
      ...BASE_CTX,
      customPrompt: 'Hello {{business_name}} — caller {{caller_phone}} on {{current_date}}.',
    });
    expect(prompt).toContain('Hello DynaTire — caller +15551234567 on Friday, April 24, 2026.');
  });

  it('CUSTOM PROMPT: anonymous-caller substitution yields "unknown" (not blank or "null")', () => {
    // WHY: a blank substitution produces "caller  on Friday..." which
    //      is mid-sentence ungrammatical; "null" leaks an internal type
    //      to the LLM. "unknown" reads naturally on both written and
    //      spoken paths.
    const prompt = buildSystemPrompt({
      ...BASE_CTX,
      callerPhone: null,
      customPrompt: 'Caller {{caller_phone}}.',
    });
    expect(prompt).toContain('Caller unknown.');
    expect(prompt).not.toContain('Caller null.');
    expect(prompt).not.toContain('Caller .');
  });

  it('CUSTOM PROMPT: unknown placeholders pass through unchanged', () => {
    // WHY: a typo like {{busniess_name}} should be visible to the
    //      operator (so they fix the template), not silently blanked
    //      out so the caller hears "Hello  thanks for calling".
    const prompt = buildSystemPrompt({
      ...BASE_CTX,
      customPrompt: 'Hello {{busniess_name}} from {{business_name}}.',
    });
    expect(prompt).toContain('Hello {{busniess_name}} from DynaTire.');
  });

  it('CUSTOM PROMPT: null / undefined / empty / whitespace falls back to the hardcoded Clara identity', () => {
    // WHY: tenants that haven't customized their persona must continue
    //      to get the working default. Whitespace-only counts as empty
    //      (catches the edge case of an owner who clears the textarea
    //      but leaves a trailing space).
    for (const customPrompt of [null, undefined, '', '   \n\t  ']) {
      const prompt = buildSystemPrompt({ ...BASE_CTX, customPrompt });
      expect(prompt).toContain('You are Clara, the AI receptionist for DynaTire.');
    }
  });

  it('PREFERENCES OFF: no "Customer preferences" section and no save tool when explicitly disabled', () => {
    // WHO: a tenant owner who opted out of preference capture in the dashboard.
    // WHAT: the prompt omits the preferences section + save tool.
    // WHEN: every call for a tenant with save_preferences_enabled = false.
    // WHERE: buildSystemPrompt preferencesEnabled branch.
    // WHY: an opt-out tenant must not have the agent saving data they didn't want captured.
    // NOTE: undefined/null/true all ENABLE (default-on); only explicit false disables.
    for (const ctx of [
      { ...BASE_CTX, savePreferencesEnabled: false },
      { ...BASE_CTX, savePreferencesEnabled: false, preferencesInstructions: 'ignored when off' },
    ]) {
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).not.toContain('# Customer preferences');
      expect(prompt).not.toContain('save_customer_preference');
    }
  });

  it('PREFERENCES ON (default): section and save tool present when flag unset or true', () => {
    // WHO: any tenant that hasn't explicitly opted out (the default state).
    // WHAT: prompt includes the preferences section + save tool.
    // WHEN: every call where savePreferencesEnabled is undefined, null, or true.
    // WHERE: buildSystemPrompt preferencesEnabled = (ctx.savePreferencesEnabled !== false).
    // WHY: preferences are on by default — returning callers should be recognized.
    for (const ctx of [
      BASE_CTX,
      { ...BASE_CTX, savePreferencesEnabled: true },
      { ...BASE_CTX, savePreferencesEnabled: undefined },
    ]) {
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('# Customer preferences');
      expect(prompt).toContain('save_customer_preference(phone, key, value)');
    }
  });

  it('PREFERENCES ON: owner instructions injected verbatim', () => {
    // WHO: a salon owner who wrote their own preference guidance.
    // WHAT: their exact text appears in the prompt's preferences section.
    // WHY: the owner's words are the steering signal — generic defaults don't
    //      know this business's nuances.
    const ownerText = 'Always offer the same stylist and ask about nails.';
    const prompt = buildSystemPrompt({
      ...BASE_CTX,
      preferencesInstructions: ownerText,
    });
    expect(prompt).toContain('# Customer preferences');
    expect(prompt).toContain(ownerText);
    expect(prompt).toContain('save_customer_preference(phone, key, value)');
  });

  it('PREFERENCES ON, no instructions: falls back to built-in default guidance', () => {
    // WHO: a tenant with preferences on but no custom instructions.
    // WHAT: sensible default guidance renders so the tool is immediately useful.
    // WHERE: buildSystemPrompt ownerPrefGuidance `||` default branch.
    // WHY: a blank instruction box must not produce an empty, useless section.
    for (const preferencesInstructions of [null, undefined, '   ']) {
      const prompt = buildSystemPrompt({
        ...BASE_CTX,
        preferencesInstructions,
      });
      expect(prompt).toContain('# Customer preferences');
      expect(prompt).toContain('Remember what each customer likes');
      expect(prompt).toContain('save_customer_preference');
    }
  });
});

describe('buildSystemPrompt — voice style injection', () => {
  it('HAPPY: ttsFormal=true injects # Voice style section with formal instruction', () => {
    // WHO: tenant with the Formal voice style checkbox checked
    // WHAT: the prompt gains a "# Voice style" section containing the formal
    //        language instruction (no contractions, precise sentences)
    // WHEN: every call session for that tenant
    // WHERE: buildSystemPrompt styleSection branch — ttsFormal guard
    // WHY: the LLM must read the instruction to apply it; without the section
    //       the "Formal" checkbox on the dashboard has zero runtime effect
    const prompt = buildSystemPrompt({ ...BASE_CTX, ttsFormal: true });
    expect(prompt).toContain('# Voice style');
    expect(prompt).toContain('formal language');
    expect(prompt).toContain('no contractions');
  });

  it('HAPPY: ttsWarm=true injects warm instruction', () => {
    // WHO: tenant with the Warm voice style checkbox checked
    // WHAT: the # Voice style section includes the warm-and-caring delivery note
    // WHEN: every call session for that tenant
    // WHERE: buildSystemPrompt styleSection branch — ttsWarm guard
    // WHY: without the instruction, the toggle is cosmetic and the LLM
    //       continues its default neutral delivery regardless of the setting
    const prompt = buildSystemPrompt({ ...BASE_CTX, ttsWarm: true });
    expect(prompt).toContain('# Voice style');
    expect(prompt).toContain('warm and caring');
  });

  it('HAPPY: ttsConcise=true injects concise instruction', () => {
    // WHO: tenant with the Concise voice style checkbox checked
    // WHAT: the # Voice style section includes the brevity instruction
    // WHEN: every call session for that tenant
    // WHERE: buildSystemPrompt styleSection branch — ttsConcise guard
    // WHY: brevity must be explicitly instructed; the LLM's default verbosity
    //       doesn't change unless it reads the instruction at call time
    const prompt = buildSystemPrompt({ ...BASE_CTX, ttsConcise: true });
    expect(prompt).toContain('# Voice style');
    expect(prompt).toContain('one sentence is better than two');
  });

  it('HAPPY: all three flags true — all three instructions present, header appears once', () => {
    // WHO: tenant with Formal + Warm + Concise all checked
    // WHAT: the # Voice style section contains all three instruction bullets
    //        and the section header appears exactly once (no duplication)
    // WHEN: every call session for that tenant
    // WHERE: buildSystemPrompt styleSection — three-item styleLines array
    // WHY: if each flag independently injected the header, the LLM would
    //       see "# Voice style" three times which could confuse parsing
    const prompt = buildSystemPrompt({
      ...BASE_CTX,
      ttsFormal: true,
      ttsWarm: true,
      ttsConcise: true,
    });
    expect(prompt).toContain('formal language');
    expect(prompt).toContain('warm and caring');
    expect(prompt).toContain('one sentence is better than two');
    // Header appears exactly once.
    const occurrences = (prompt.match(/# Voice style/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('HAPPY: no style flags — no # Voice style section injected', () => {
    // WHO: tenant with no voice style checkboxes checked (the default)
    // WHAT: the prompt is byte-for-byte unchanged — no # Voice style section
    // WHEN: every call for a tenant who hasn't enabled any style flag
    // WHERE: buildSystemPrompt — styleLines.length === 0 → styleSection = ''
    // WHY: the feature must be strictly opt-in; a blank tenant must not see
    //       any style instructions in their prompt
    const prompt = buildSystemPrompt(BASE_CTX);
    expect(prompt).not.toContain('# Voice style');
  });

  it('HAPPY: null style flags treated as off — no style section', () => {
    // WHO: tenant whose DB columns are NULL (never set — the DB default)
    // WHAT: null values must behave identically to false — no style section
    // WHEN: a brand-new tenant who has never visited the AI Persona page
    // WHERE: buildSystemPrompt styleLines — falsy-check on null
    // WHY: DB nullable booleans arrive as null in JS; treating null as true
    //       would inject style instructions for every new tenant by default
    const prompt = buildSystemPrompt({
      ...BASE_CTX,
      ttsFormal: null,
      ttsWarm: null,
      ttsConcise: null,
    });
    expect(prompt).not.toContain('# Voice style');
  });

  it('HAPPY: false style flags treated as off — no style section', () => {
    // WHO: tenant who explicitly unchecked all style checkboxes and saved
    // WHAT: explicit false values produce no style section (same as null)
    // WHEN: after an owner visits AI Persona and saves with all boxes unchecked
    // WHERE: buildSystemPrompt styleLines — falsy-check on false
    // WHY: regression guard; a change to the if-condition must not treat
    //       false as truthy and accidentally re-enable style injection
    const prompt = buildSystemPrompt({
      ...BASE_CTX,
      ttsFormal: false,
      ttsWarm: false,
      ttsConcise: false,
    });
    expect(prompt).not.toContain('# Voice style');
  });

  it('HAPPY: two of three flags — only those two instructions appear', () => {
    // WHO: tenant with Formal and Warm checked, Concise unchecked
    // WHAT: exactly two instructions are injected; the concise instruction
    //        is absent so the LLM has no brevity directive
    // WHEN: every call for that tenant
    // WHERE: buildSystemPrompt styleLines — flag-by-flag push
    // WHY: each flag must be independently controlled; checking Formal must
    //       not silently enable Concise as a side-effect
    const prompt = buildSystemPrompt({
      ...BASE_CTX,
      ttsFormal: true,
      ttsWarm: true,
      ttsConcise: false,
    });
    expect(prompt).toContain('formal language');
    expect(prompt).toContain('warm and caring');
    expect(prompt).not.toContain('one sentence is better than two');
  });

  it("HAPPY: style section appears AFTER # Conversation style, BEFORE # Today's context", () => {
    // WHO: any tenant with at least one style flag enabled
    // WHAT: the # Voice style section is positioned inside the conversation
    //        style block — after # Conversation style content, before # Today's context
    // WHEN: every call for a tenant with style flags set
    // WHERE: buildSystemPrompt template — styleSection injected at end of
    //         Conversation style bullet list, before Today's context header
    // WHY: section order affects LLM attention; putting voice style AFTER the
    //       conversation-style rules and BEFORE the call-specific context
    //       keeps it near peer instructions and away from factual data blocks
    const prompt = buildSystemPrompt({ ...BASE_CTX, ttsFormal: true });
    const convStyleIdx = prompt.indexOf('# Conversation style');
    const voiceStyleIdx = prompt.indexOf('# Voice style');
    const todaysCtxIdx = prompt.indexOf("# Today's context");
    expect(convStyleIdx).toBeGreaterThan(-1);
    expect(voiceStyleIdx).toBeGreaterThan(convStyleIdx);
    expect(voiceStyleIdx).toBeLessThan(todaysCtxIdx);
  });

  it('SAD: style flags present but identity section still correct', () => {
    // WHO: tenant with Formal checked and a custom persona prompt
    // WHAT: the identity section (Clara line or custom prompt) is not
    //        corrupted by the presence of style flags
    // WHEN: any call where both a custom prompt and style flags are set
    // WHERE: buildSystemPrompt — identitySection built independently of styleSection
    // WHY: the two features operate on different output regions; a merge
    //       conflict or code reorder could accidentally overwrite the identity
    const prompt = buildSystemPrompt({ ...BASE_CTX, ttsFormal: true });
    // Default identity is present and correct.
    expect(prompt).toContain('You are Clara, the AI receptionist for DynaTire.');
    // Style section is also present.
    expect(prompt).toContain('# Voice style');
    expect(prompt).toContain('formal language');
  });

  it('SAD: style section does not bleed into preference section', () => {
    // WHO: tenant with Formal checked and Customer Preferences enabled
    // WHAT: both the # Customer preferences section and # Voice style section
    //        appear separately — the style injection must not corrupt or
    //        replace the preferences block
    // WHEN: any call where both features are active simultaneously
    // WHERE: buildSystemPrompt — preferencesSection and styleSection are
    //         independently constructed strings appended at different points
    // WHY: two independent prompt features must be additive; enabling one
    //       must not suppress or garble the other
    const prompt = buildSystemPrompt({
      ...BASE_CTX,
      ttsFormal: true,
      preferencesInstructions: 'Note preferred stylist.',
    });
    expect(prompt).toContain('# Customer preferences');
    expect(prompt).toContain('# Voice style');
    // Both sections exist and are distinct.
    expect(prompt.indexOf('# Customer preferences')).not.toBe(prompt.indexOf('# Voice style'));
  });
});

describe('formatDateForPrompt', () => {
  it('HAPPY: renders a full weekday+month+day+year string in the tenant timezone', () => {
    // WHO: Scheduler said "book me Tuesday" — the LLM needs to know
    //        today to compute Tuesday's date
    const date = new Date('2026-04-24T17:30:00Z'); // 12:30 PM CDT
    expect(formatDateForPrompt(date, 'America/Chicago')).toBe('Friday, April 24, 2026');
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
