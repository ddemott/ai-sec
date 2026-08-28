import type { llm } from '@livekit/agents';
import type { TransferResult } from '../transferClient.js';

export type ToolMap = Record<string, ReturnType<typeof llm.tool>>;

/**
 * Capability groups. Every tool belongs to exactly one; a customer agent can
 * compose a subset via `buildTools(..., { capabilities: [...] })` (e.g. a
 * message-taking line needs only 'knowledge' + 'messaging'). Default = all.
 * The grouping also documents which tools to lift together when copying a
 * capability into another agent.
 */
export type Capability =
  | 'knowledge'
  | 'messaging'
  | 'identity'
  | 'scheduling'
  | 'verification'
  | 'transfer'
  // Texting. Its OWN capability, not part of 'scheduling', precisely so it can be
  // switched off while booking keeps working — which is the state we are in until
  // 10DLC registration lands and a text can actually reach a handset.
  | 'sms';

export const CAPABILITY_OF: Record<string, Capability> = {
  // The phase routers (toolPhases.ts). 'scheduling', because that is where they
  // LEAD — so a session built without scheduling loses the doors along with the
  // rooms, rather than keeping a door that opens onto nothing.
  start_booking: 'scheduling',
  manage_appointment: 'scheduling',
  get_company_policy_answer: 'knowledge',
  take_message: 'messaging',
  capture_job_inquiry: 'messaging',
  capture_case_inquiry: 'messaging',
  page_owner_via_sms: 'messaging',
  get_customer_context: 'identity',
  get_detailed_customer_history: 'identity',
  // 'sms', NOT 'scheduling' (moved 2026-07-17). This tool TEXTS the caller a
  // link — and until 10DLC lands, no text this product sends reaches a handset
  // (the carrier drops it; Telnyx reports success anyway). Filed under
  // 'scheduling' it ESCAPED the ENABLE_SMS gate: on a live call the model
  // could call it, get a success result, and truthfully relay "I've texted you
  // a link" — for a text that dies at the carrier. The exact
  // promise-what-you-cannot-do lie the SMS gate exists to make impossible,
  // arriving through a mis-filed capability. Found because Dale asked, of a
  // green eval case: "But we aren't texting." With 'sms' off this tool is now
  // absent and the agent handles cancel/reschedule live, which is the honest
  // path it already knows.
  send_self_service_link: 'sms',
  find_caller_by_name: 'identity',
  identify_caller: 'identity',
  save_customer_preference: 'identity',
  record_sms_consent: 'sms',
  get_service_catalog: 'scheduling',
  get_available_slots: 'scheduling',
  get_scheduling_options: 'scheduling',
  check_availability: 'scheduling',
  book_appointment: 'scheduling',
  book_with_scheduling: 'scheduling',
  get_my_appointments: 'scheduling',
  cancel_appointment: 'scheduling',
  reschedule_appointment: 'scheduling',
  // Deliberately in NO toolPhases list: only the meeting-goals rung (task-group path)
  // holds it. The ladder path has no wrap-up-notes step, so it never sees the tool.
  attach_meeting_notes: 'scheduling',
  send_verification_code: 'verification',
  verify_phone_code: 'verification',
  transfer_call: 'transfer',
};

/**
 * Live-transfer capability handed to buildTools. `forwardPhone` is the
 * destination (owner cell, NULL = unconfigured); `execute` performs the SIP
 * REFER and is null when the call lacks the room/participant context needed to
 * transfer. Kept separate from SessionContext so tools never import the
 * livekit-server-sdk and stay unit-testable with a plain mock.
 */
export interface TransferCapability {
  forwardPhone: string | null;
  execute: ((forwardPhone: string | null) => Promise<TransferResult>) | null;
}
