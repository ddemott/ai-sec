/**
 * WHICH TOOLS CAN THE MODEL SEE RIGHT NOW?
 *
 * We hand gpt-4o-mini all 23 tools on every turn of every call. That is over
 * every published ceiling: OpenAI's own function-calling guide says "aim for
 * fewer than 20 functions available at the start of a turn", and LiveKit's tool
 * docs say 5-12, warning that past 20 the model gets "dramatically more chances
 * to hallucinate a call". The research is consistent — selection accuracy falls
 * off a cliff as the catalogue grows, and subsetting the tools recovers most of
 * it.
 *
 * We have the receipts locally. From the tool-selection eval, with all 23 tools
 * live, on the take-a-message case:
 *
 *     sequence: (no tools called)
 *     said: "I'll take a message for the owner. One moment, please. ...
 *            I've sent the owner a message about your call regarding the
 *            overdue invoice."
 *
 * It called NOTHING and told the caller it was done. It even emitted a literal
 * "..." to role-play the time a tool would have taken.
 *
 * WE ALREADY TRIED THE PROMPT. The system prompt has forbidden this in bold, in
 * a section of its own, for weeks ("NEVER CLAIM YOU DID SOMETHING YOU DID NOT
 * DO"). We removed the instruction that invited it. We dropped the temperature
 * to 0. The model still narrates the action instead of performing it, because a
 * plausible sentence satisfies the caller and costs it nothing.
 *
 * So stop asking. A model cannot pick the wrong tool from a set that does not
 * contain it, and it is far likelier to pick the RIGHT one when there are six
 * candidates instead of twenty-three. This module is the set.
 *
 * ---
 *
 * THE PHASES ARE THE CALL, not the code. A receptionist call has an arc, and at
 * each point in it only a handful of actions make sense:
 *
 *   INTAKE   who is this, and what do they want? Ends in one of three ways: they
 *            want a NEW appointment, they want to change an EXISTING one, or they
 *            want something that isn't scheduling at all (a message, the owner, a
 *            human, an answer).
 *   BOOKING  they want a new appointment. Find a time, get consent to text, book.
 *   MANAGE   they have an appointment already. Look it up, move it, cancel it.
 *
 * Two things are true of every phase and are deliberately repeated in each:
 *
 *   - take_message. A booking that falls through must be able to pivot to a
 *     message without a phase change — the prompt has always promised the caller
 *     that pivot, and a phase machine that makes it impossible would be a worse
 *     bug than the one it fixes.
 *   - transfer_call. Escalation to a human is never off the table. (Filtered out
 *     anyway by the 'transfer' capability when no forward number is configured.)
 *
 * WHAT IS DELIBERATELY ABSENT FROM 'booking': book_appointment and
 * check_availability. Both need a resource_id that get_available_slots does not
 * return, so the model that reaches for them after get_available_slots produces
 * a booking that fails validation — that is GH bug #3, and the eval still carries
 * a regression case for it. Excluding them from the phase where the mistake is
 * possible kills that entire class BY CONSTRUCTION rather than by asking the
 * model nicely not to. book_with_scheduling does everything they do.
 */

/** The arc of a call. Every tool is visible in at least one of these. */
export type CallPhase = 'intake' | 'booking' | 'manage';

/**
 * The routing tools. These are the ONLY way out of intake, which is what makes
 * them reliable: the model cannot get at get_available_slots by talking, so the
 * one path to the thing the caller asked for runs through a real tool call.
 */
export const PHASE_ROUTERS = {
  start_booking: 'booking',
  manage_appointment: 'manage',
} as const satisfies Record<string, CallPhase>;

export type PhaseRouter = keyof typeof PHASE_ROUTERS;

/**
 * Tool names visible in each phase. A name listed here that a session does not
 * have (because a capability is off — e.g. 'verification' when
 * ENABLE_PHONE_VERIFICATION=false) is simply absent; the intersection is taken,
 * never the union. Capability gating stays authoritative — phases only ever
 * NARROW, they never grant.
 */
export const PHASE_TOOLS: Record<CallPhase, readonly string[]> = {
  // Who is calling, what do they want, and every ending that isn't scheduling.
  intake: [
    'identify_caller',
    'get_customer_context',
    'get_detailed_customer_history',
    'find_caller_by_name',
    'send_verification_code',
    'verify_phone_code',
    'get_service_catalog',
    'get_company_policy_answer',
    'take_message',
    'page_owner_via_sms',
    'capture_job_inquiry',
    'transfer_call',
    // "I'm driving — just text me a link and I'll move it myself" is a COMPLETE
    // intent, not a step on the way to one. It reveals no calendar and changes no
    // booking; it hands the caller a link and the call is done. Routing it through
    // the manage phase was a mistake, and the eval caught it immediately: asked to
    // text a link, the model could not find the tool, never thought to open the
    // door, and looped get_detailed_customer_history NINE TIMES trying to satisfy
    // the caller some other way. That is a stranded caller — the model WANTED the
    // right thing and we had hidden it. Narrowing must never remove an exit.
    'send_self_service_link',
    'start_booking',
    'manage_appointment',
  ],

  // A NEW appointment. Note the absence of book_appointment / check_availability
  // (see the header) — book_with_scheduling is the only booking path from here.
  booking: [
    'get_service_catalog',
    'get_available_slots',
    'get_scheduling_options',
    'book_with_scheduling',
    'record_sms_consent',
    'save_customer_preference',
    'identify_caller',
    'take_message',
    'transfer_call',
  ],

  // An appointment that already exists. get_available_slots is here because a
  // reschedule needs a new time, and send_self_service_link because "just text
  // me a link" is a perfectly good answer to "I need to move my haircut".
  manage: [
    'get_my_appointments',
    'cancel_appointment',
    'reschedule_appointment',
    'get_available_slots',
    'send_self_service_link',
    'identify_caller',
    'take_message',
    'transfer_call',
  ],
};

/**
 * Narrow a full ToolContext down to one phase.
 *
 * Generic over the tool-map shape rather than importing LiveKit's ToolContext,
 * so this module (and its tests) need no LiveKit runtime — same reasoning as
 * sessionContext.ts.
 *
 * Intersection, never union: a tool the session never had cannot reappear here.
 */
export function toolsForPhase<T extends Record<string, V>, V>(all: T, phase: CallPhase): T {
  const allowed = new Set<string>(PHASE_TOOLS[phase]);
  const out: Record<string, V> = {};
  for (const [name, tool] of Object.entries(all)) {
    if (allowed.has(name)) out[name] = tool;
  }
  // A tool MAP with fewer keys, not a partial of a fixed shape: LiveKit's
  // ToolContext is an index signature (Record<string, FunctionTool>), so a subset
  // of its keys is still exactly a ToolContext. Partial<T> would wrongly widen
  // every value to `| undefined`.
  return out as T;
}
