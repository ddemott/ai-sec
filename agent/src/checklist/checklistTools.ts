/**
 * THE CONVERSATION LAYER'S TOOLSET — question-tree phase 3
 * (docs/QUESTION_TREE_ARCHITECTURE.md §3.3).
 *
 * This is the seam where the model meets the ChecklistTracker. Every tool here
 * follows one contract: THE TOOL RESULT CARRIES THE STATE. The rendered
 * checklist (or the corrective error) rides back in the result — the one piece
 * of context the model reliably re-reads all call (the standing_fact lesson,
 * 2026-07-21 double-booking) — so the model never has to remember what is open;
 * it just reads it.
 *
 * Built as an injectable factory (no LiveKit session, effects passed in) so the
 * whole layer is unit-testable by calling the executes directly — the same
 * reason the tracker is pure.
 *
 * Guarantees enforced HERE, not hoped for in the prompt:
 *  - an action tool refuses while its node is blocked (and says what is first)
 *  - a DONE action refuses a repeat — the anti-double-book gate
 *  - two consecutive real failures of one action → advice to stop retrying and
 *    take a message (the HARD-DOWN rule 15 shape: {error, error_code})
 *  - finish_call cannot close the call while the checklist is open
 *  - identify_caller fires from HOST CODE the moment name + phone are both in
 *    (PR #266: message-leaving callers used to never reach the phone book)
 */
import { llm } from '@livekit/agents';
import { getLogger } from '../logger.js';
import { sanitizeVolunteered } from '../tasks/sanitize.js';
import { normalizeSpelledName, splitNameAndCompany } from '../nameCleanup.js';
import {
  type ChecklistTracker,
  RecordError,
  UnknownNodeError,
  UnknownTreeError,
} from './tracker.js';
import type { ActionNodeDef, NodeId, QuestionTreeDef } from './types.js';
import { CALLER_NAME, CALLER_PHONE } from './trees.js';

/** The JSON field whose presence in a tool's result proves the write LANDED. */
const ACTION_ID_FIELDS: Record<string, string> = {
  book_with_scheduling: 'appointment_id',
  take_message: 'message_id',
  capture_job_inquiry: 'job_inquiry_id',
  cancel_appointment: 'appointment_id',
  reschedule_appointment: 'appointment_id',
};

/**
 * Actions whose write can be REDONE when an answer it consumed is corrected.
 *
 * 2026-07-27 (SCL_ReG7kLRiY94c, CALL_IMPROVEMENTS.md #2): the caller's name was
 * heard as "Jamil", take_message wrote the row, and thirty seconds later she
 * corrected it — "Camille, C-A-M-I-L-L-E". The tracker updated. The row did
 * not. It still says Jamil in production. Host-owned state that a landed write
 * ignores is the same state theater as the dropped location_type, one layer
 * later: we fixed what the write READS and never fixed what happens when the
 * reading CHANGES.
 *
 * Only tools that are idempotent per call belong here — take_message upserts on
 * (tenant_id, call_id) since migration 20260801000000, so re-firing rewrites its
 * own row. capture_job_inquiry is deliberately ABSENT despite being idempotent:
 * its route returns the existing row unchanged on conflict (DO NOTHING), so a
 * re-fire would be a lie dressed as a fix. Booking actions are absent for a
 * blunter reason — a corrected name must never silently move an appointment.
 */
const REWRITABLE_ON_CORRECTION: Record<string, readonly NodeId[]> = {
  take_message: [CALLER_NAME, CALLER_PHONE, 'message_body'],
};

/** Read tools a tree needs alongside its action (the calendar for a booking). */
const TREE_PASSTHROUGH_TOOLS: Record<string, string[]> = {
  booking: ['get_available_slots', 'get_service_catalog'],
  schedule_change: ['get_my_appointments', 'get_available_slots'],
  // A sales call's write is the DEMO BOOKING, so buy_service has no action node of
  // its own (an action that cannot complete would hold the goodbye gate open — see
  // BUY_SERVICE_TREE). attach_meeting_notes rides along so the qualifying answers can
  // reach the owner ON the meeting; unwrapped, so it never gates anything and is
  // simply unavailable-by-error when no booking happened.
  buy_service: ['attach_meeting_notes'],
  // Recognizing a returning caller and proving a SPOKEN number both live behind
  // the identity tree — every goal-bearing call selects it (its own description:
  // "Select for EVERY call whose goals need a contact"). Before this, these three
  // tools were fully built end-to-end on the backend (the disclosure gate in
  // callerMayHearCustomerData, the call-bound phone_verifications row, ctx.callerPhone
  // adoption on verify_phone_code success) and completely unreachable on a live
  // call: selectedTools() never offered them, so a forwarded-line caller could
  // never be recognized or proven, no matter what the backend was ready to do.
  identity: ['get_customer_context', 'send_verification_code', 'verify_phone_code'],
};

/**
 * HOST-SIDE ARG BACKFILL (2026-07-21, first live tree call): the tracker HOLDS
 * every recorded answer, but wrapAction forwarded only what the model RETYPED
 * into the action's args — and on the first live call it silently dropped
 * location_type (the caller crisply answered "On-site"; the checklist showed
 * work_mode ✓) and rate_range. Host-owned state that the write ignores is
 * state theater. So: any arg the model omits is filled from the tracker's
 * answer for the mapped node(s); the model's own args win when present
 * (it may legitimately normalize phrasing). Declined/empty answers never fill.
 */
type ArgFill = { arg: string; from: readonly string[]; map?: (v: string) => unknown };
// Exported for the capture-completeness test: every collected tree node must map
// to a tool param here (or be an explicitly-declared control node) — the guard
// that turns a silently-dropped field (role_description, found 2026-07-30) into
// a CI failure instead of a prod discovery.
export const ACTION_ARG_BACKFILL: Record<string, readonly ArgFill[]> = {
  capture_job_inquiry: [
    { arg: 'caller_name', from: ['caller_name'] },
    { arg: 'callback_phone', from: ['caller_phone'] },
    { arg: 'caller_company', from: ['callers_company'] },
    { arg: 'client_company', from: ['client_company'] },
    { arg: 'represents_company', from: ['hiring_for'], map: (v) => v === 'own_company' },
    {
      arg: 'employment_type',
      from: ['employment_type'],
      // contract_to_hire is first-class end to end since 2026-07-21 — this map
      // used to collapse it into 'contract' because the backend enum lacked it,
      // and when the MODEL passed the honest value instead, the backend bounced
      // the whole capture mid-call. Known values pass through untouched.
      map: (v) => (['contract', 'full_time', 'contract_to_hire'].includes(v) ? v : 'contract'),
    },
    // The field the pipeline used to LOSE (verified on prod call SCL_nRKo3KEVw8Yh,
    // 2026-07-30): the tree collected the role, the checklist showed ✓, and the
    // write had no param — the paragraph survived only in the transcript.
    { arg: 'role_description', from: ['role_description'] },
    { arg: 'rate_range', from: ['rate_range', 'salary_range'] },
    { arg: 'duration', from: ['contract_length', 'conversion_terms'] },
    {
      arg: 'location_type',
      from: ['work_mode'],
      map: (v) => (['onsite', 'remote', 'hybrid'].includes(v) ? v : undefined),
    },
    { arg: 'address', from: ['position_address'] },
    { arg: 'timezone', from: ['team_timezone'] },
  ],
  book_with_scheduling: [{ arg: 'phone', from: ['caller_phone'] }],
  // take_message had NO backfill at all: every value came from the model
  // retyping it, which is the same state-theater exposure that lost
  // location_type and role_description on other tools — and it is what made a
  // CORRECTION re-fire arrive empty (found by the batch-D test, 2026-08-01).
  // The checklist holds all three facts; the write should read them from there.
  take_message: [
    { arg: 'caller_name', from: [CALLER_NAME] },
    { arg: 'callback_phone', from: [CALLER_PHONE] },
    { arg: 'message', from: ['message_body'] },
  ],
};

/** How many times set_purpose may fire before the call is told to wrap up. */
/** Subject trees whose co-selection with booking ANSWERS the meeting-topic
 *  question — the caller who asked to "talk to Dale about a job" has already
 *  said what the meeting is about. generic_subject is absent on purpose: its
 *  subject is whatever the caller says it is, and only they can say it. */
const TREE_TOPIC: Record<string, string> = {
  job: 'a job opportunity',
  fix_computer: 'a computer repair',
};

const DEFAULT_MAX_PURPOSE_ROUNDS = 5;

/** After this many consecutive failures an action is told to stop retrying. */
const ACTION_FAILURE_LIMIT = 2;

/** The uniform way to reach a real tool's internals (rung.ts precedent). */
interface RealToolShape {
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: unknown, toolCtx: unknown) => Promise<unknown>;
}
const shape = (t: llm.ToolContext[string]): RealToolShape => t as unknown as RealToolShape;

export interface ChecklistToolDeps {
  tracker: ChecklistTracker;
  library: QuestionTreeDef[];
  /** The full ToolContext from buildTools() — real tools, untouched. */
  realTools: llm.ToolContext;
  /** Carrier-attested caller number (null on forwarded lines) — auto-fills the
   *  caller_phone node on selection so the question never exists on that call. */
  callerPhone?: string | null;
  maxPurposeRounds?: number;
  /** The agent reschedules its toolset (macrotask-deferred updateTools). */
  onSelectionChanged: () => void;
  /** Speak the fixed goodbye and close the session. */
  closeCall: (goodbye: string) => Promise<void>;
}

export interface ChecklistToolkit {
  /** Base + wrapped actions + read passthroughs for the CURRENT selection. */
  selectedTools: () => llm.ToolContext;
}

interface ActionSite {
  treeId: string;
  def: ActionNodeDef;
}

/** Every action node in the library, found once, wherever it nests. */
function collectActions(library: QuestionTreeDef[]): Map<string, ActionSite> {
  const out = new Map<string, ActionSite>();
  const walk = (nodes: QuestionTreeDef['nodes'], treeId: string): void => {
    for (const def of nodes) {
      if (def.type === 'action' && !out.has(def.node_id)) out.set(def.node_id, { treeId, def });
      if (def.type === 'choice') {
        for (const children of Object.values(def.options)) walk(children, treeId);
      }
    }
  };
  for (const tree of library) walk(tree.nodes, tree.tree_id);
  return out;
}

/** Pull the success id out of a real tool's JSON-string result, or null. */
function extractSuccessId(raw: unknown, idField: string): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const id = (parsed as Record<string, unknown>)[idField];
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export function createChecklistTools(deps: ChecklistToolDeps): ChecklistToolkit {
  const { tracker, realTools } = deps;
  const maxRounds = deps.maxPurposeRounds ?? DEFAULT_MAX_PURPOSE_ROUNDS;
  const actionSites = collectActions(deps.library);
  const treeIds = deps.library.map((t) => t.tree_id);

  let purposeRounds = 0;
  // What identify_caller was last told, so a CORRECTION can be re-sent. It used
  // to be a plain "sent once" latch, which meant the first (name, phone) pair
  // the call produced was the only one the phone book ever heard: "Jamil" was
  // saved, "Camille" was recorded in the tracker, and the CRM kept Jamil
  // (CALL_IMPROVEMENTS.md #2).
  let identifiedAs: { name: string; phone: string } | null = null;
  let closing = false;
  const failCounts = new Map<string, number>();

  // Every state block ends with an explicit NEXT pointer — the first frontier
  // item in walk order. Without it the model treats a ready [ACTION NOW] as
  // scenery and keeps asking questions: on the E2E replay of the 2026-07-21
  // call it ran the entire job intake past a ready book action (the exact
  // "you just blew right past that" failure the walk order exists to prevent).
  // The walk order is host truth; this line makes it an instruction, not a hint.
  const stateBlock = (): string => {
    const next = tracker.frontier()[0];
    const pointer = !next
      ? ''
      : next.kind === 'action'
        ? `\nNEXT: ${next.node_id} — an ACTION, not a question. Do it now, before asking anything else. Do NOT ask another question until this action is handled or explicitly blocked.`
        : `\nNEXT: ask ${next.node_id}. This is the ONLY question you may ask next.`;
    return `CHECKLIST STATE:\n${tracker.renderState()}${pointer}`;
  };

  const repeatGuardDirective = (resolvedNodeId: string): string => {
    const next = tracker.frontier()[0];
    const noRepeat = `\n\n${resolvedNodeId} is already resolved. Do NOT ask ${resolvedNodeId} again.`;
    if (!next) return noRepeat;
    return next.kind === 'action'
      ? `${noRepeat} ${next.node_id} is an ACTION now — do that before asking anything else.`
      : `${noRepeat} The ONLY question you may ask next is ${next.node_id}.`;
  };

  /** Host-code phone-book save the moment both identity facts are in — never
   *  the model's job, never skipped when the caller only leaves a message. */
  const maybeIdentify = (): void => {
    const name = tracker.value(CALLER_NAME);
    const phone = tracker.value(CALLER_PHONE);
    const identify = realTools['identify_caller'];
    if (!name || !phone || !identify) return;
    // Unchanged since the last send → nothing to do. CHANGED → send again: the
    // caller corrected something, and the phone book must hear the correction.
    if (identifiedAs && identifiedAs.name === name && identifiedAs.phone === phone) return;
    const isCorrection = identifiedAs !== null;
    identifiedAs = { name, phone };
    void shape(identify)
      .execute(
        {
          name,
          phone,
          // Scoped on purpose: this permits overwriting a name THIS CALL wrote.
          // It is never a licence to rename an established customer from a
          // later call — anyone can dial a number and claim a name, and that
          // is the claim-based trust the OTP call-binding exists to destroy.
          ...(isCorrection ? { is_correction: true } : {}),
        },
        undefined
      )
      .catch((err: unknown) => {
        getLogger().warn(
          { event: 'checklist_identify_failed', is_correction: isCorrection, err: String(err) },
          'host-code identify_caller failed — caller not saved to phone book'
        );
      });
  };

  const recordIfOpen = (nodeId: string, value: string | undefined): void => {
    if (!value) return;
    const status = tracker.status(nodeId);
    if (status !== 'open' && status !== 'latent') return;
    try {
      tracker.record(nodeId, { value });
    } catch {
      /* volunteered extras never break a selection */
    }
  };

  const set_purpose = llm.tool({
    description:
      'Set (or extend) what this call is about. Call the MOMENT you know why they called, ' +
      'and again any time a NEW goal surfaces. Pass every tree that matches; pass ' +
      'wrong_trees to remove a tree selected by mistake. If the caller already volunteered ' +
      'their name or number, pass those along exactly as spoken.',
    parameters: {
      type: 'object',
      properties: {
        work_direction: {
          type: 'string',
          enum: ['caller_pays_us', 'caller_offers_owner_work', 'neither_or_unclear'],
          description:
            'WHICH WAY THE WORK FLOWS — answer this BEFORE picking trees. caller_pays_us: ' +
            'they want to BUY something from this business (the AI service, a repair, a ' +
            'visit). caller_offers_owner_work: they bring a job, role, contract, or project ' +
            'the OWNER would be paid for. neither_or_unclear: a message, a question, a ' +
            'schedule change — or you genuinely cannot tell yet.',
        },
        trees: {
          type: 'array',
          items: { type: 'string', enum: treeIds },
          description: 'The tree ids matching what the caller wants (see the menu).',
        },
        wrong_trees: {
          type: 'array',
          items: { type: 'string', enum: treeIds },
          description: 'Trees selected earlier by MISTAKE — removed, their questions dropped.',
        },
        caller_name: {
          type: 'string',
          description: 'ONLY if the caller stated their own name this call — exactly as said.',
        },
        caller_phone: {
          type: 'string',
          description: 'ONLY if the caller spoke a number for themselves — digits as said.',
        },
      },
      required: ['work_direction', 'trees'],
    },
    execute: (args: {
      work_direction?: string;
      trees: string[];
      wrong_trees?: string[];
      caller_name?: string;
      caller_phone?: string;
    }): Promise<string> => Promise.resolve(runSetPurpose(args)),
  });

  function runSetPurpose(args: {
    work_direction?: string;
    trees: string[];
    wrong_trees?: string[];
    caller_name?: string;
    caller_phone?: string;
  }): string {
    {
      // THE WORK-DIRECTION GATE (2026-07-28 sim: a buyer opening with "a business
      // opportunity" got the JOB tree alongside buy_service, whose blocked capture
      // held the goodbye gate open — the agent repeated one sentence nine times on
      // a call that could not end). buy_service and job are the one confusable
      // pair with EVIDENCE of confusion, and they sit on opposite ends of a single
      // axis: who pays whom. Making the model DECLARE the axis, then checking the
      // declaration against the selection IN HOST CODE, turns a prompt hope into a
      // deterministic bounce. Every refusal names the satisfiable next step.
      // Deliberately narrow — only the pair that actually failed; a full
      // intent-tree compatibility matrix is speculation until a call pays for it.
      const dir = args.work_direction;
      const picksJob = args.trees.includes('job');
      const picksBuy = args.trees.includes('buy_service');
      if (picksJob && picksBuy) {
        return (
          'REFUSED: job and buy_service contradict each other — one caller cannot both ' +
          'offer the owner work and buy the service in the same breath. Ask which it is ' +
          '("Are you looking to hire him, or interested in the AI receptionist for your ' +
          'own business?"), then select ONE of them.'
        );
      }
      if (dir === 'caller_pays_us' && picksJob) {
        return (
          'REFUSED: you said the caller is PAYING US, but selected the job tree — that ' +
          'tree is for work the OWNER gets paid for. If they want to buy the AI service, ' +
          'select buy_service; if you are unsure which way the work flows, ask them first.'
        );
      }
      if (dir === 'caller_offers_owner_work' && picksBuy) {
        return (
          'REFUSED: you said the caller is OFFERING THE OWNER WORK, but selected ' +
          'buy_service — that tree is for callers buying the AI receptionist for their own ' +
          'business. If they have a role or contract for the owner, select job; if you are ' +
          'unsure, ask them first.'
        );
      }
      if (dir === 'neither_or_unclear' && (picksJob || picksBuy)) {
        return (
          'REFUSED: you marked the work direction UNCLEAR but selected ' +
          (picksJob ? 'job' : 'buy_service') +
          ' — the two trees on that axis look alike from a vague opener, and a wrong pick ' +
          'interrogates the caller down the wrong track. Ask ONE clarifying question ' +
          '("Are you looking to hire him, or interested in the AI receptionist for your ' +
          'own business?") and select once they answer. Other trees (message, qa, booking, ' +
          'schedule_change) may be selected now.'
        );
      }
      purposeRounds += 1;
      if (purposeRounds > maxRounds) {
        return (
          'The purpose has changed enough times this call. Do NOT select again — finish ' +
          `what is open, then finish_call. ${stateBlock()}`
        );
      }
      for (const id of args.wrong_trees ?? []) tracker.deselect(id);
      try {
        tracker.select(args.trees);
      } catch (err) {
        if (err instanceof UnknownTreeError) return err.message;
        throw err;
      }
      recordIfOpen(CALLER_NAME, sanitizeVolunteered(args.caller_name, 80));
      recordIfOpen(CALLER_PHONE, sanitizeVolunteered(args.caller_phone, 30));
      // The subject tree IS the meeting topic (2026-07-21, the third re-ask on a
      // live call): when booking rides along with a known-subject tree, the
      // caller already said what the meeting is about — asking "What is the
      // meeting about, in your own words?" after "talk to Dale about a job"
      // tells them nobody listened. Host-recorded because the prompt-tier rule
      // failed three calls running (the promotion ladder).
      if (tracker.selectedTrees().includes('booking')) {
        for (const [treeId, topic] of Object.entries(TREE_TOPIC)) {
          if (tracker.selectedTrees().includes(treeId)) recordIfOpen('meeting_topic', topic);
        }
      }
      // Caller-ID seeding: on an attested line the phone question never exists.
      let callerIdNote = '';
      if (deps.callerPhone && tracker.status(CALLER_PHONE) === 'open') {
        tracker.record(CALLER_PHONE, { value: deps.callerPhone });
        callerIdNote =
          " The caller's number is on file from caller ID — never ask for it and never " +
          'recite it back at them. ';
      }
      maybeIdentify();
      deps.onSelectionChanged();
      // THE UNDER-SELECTION NUDGE (2026-07-27 live call, 17:57 UTC): the caller
      // said "talk with Jane about the job opportunities, he shared the resume" —
      // the model selected booking ONLY, booked 1:00, asked zero role questions,
      // and closed. The meeting landed; the role details never did. The gate
      // above blocks CONTRADICTIONS; this covers the OMISSION: direction says
      // the owner is being offered paid work, but no job tree is selected. A
      // NUDGE, not a refusal — a recruiter returning the owner's call about an
      // existing arrangement legitimately selects message without job — carried
      // in the tool result, the one channel the model reliably re-reads.
      const jobNudge =
        dir === 'caller_offers_owner_work' && !tracker.selectedTrees().includes('job')
          ? '\n\nNOTE: you declared the caller is OFFERING THE OWNER WORK, but the job ' +
            'tree is not selected — so nothing on this checklist will collect the role. ' +
            'If there is a role, position, or contract to record, call set_purpose again ' +
            'and ADD job: the role questions are what actually reaches the owner. Skip ' +
            'this only if they are not describing a role (e.g. returning his call about ' +
            'an existing arrangement).'
          : '';
      // A number VOLUNTEERED through this door still needs its read-back — only
      // if it actually landed as this node's value (not blocked by caller ID).
      const volunteered = sanitizeVolunteered(args.caller_phone, 30);
      const dictated =
        volunteered && tracker.value(CALLER_PHONE) === volunteered ? volunteered : undefined;
      return `Purpose set: ${tracker.selectedTrees().join(' + ')}.${callerIdNote}\n${stateBlock()}${jobNudge}${readbackDirective(dictated)}`;
    }
  }

  // A dictated value that IS a ten-digit US phone number → the exact spoken
  // read-back string ("2 6 2, 4 9 7, 9 0 3 9"): digits spaced individually,
  // 3-3-4 groups, leading 1 dropped. Anything else (prices, partial numbers,
  // words) returns null and gets no directive.
  function phoneReadback(raw: string): string | null {
    const digits = raw.replace(/\D/g, '');
    const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (ten.length !== 10) return null;
    const spaced = (s: string) => s.split('').join(' ');
    return `${spaced(ten.slice(0, 3))}, ${spaced(ten.slice(3, 6))}, ${spaced(ten.slice(6))}`;
  }

  // The read-back directive for a DICTATED number — appended to whichever tool
  // result recorded it. A dictated number has TWO doors into the tracker
  // (record_answer, and set_purpose's volunteered caller_phone); the 2026-07-21
  // eval caught the read-back silently skipped whenever the caller volunteered
  // the number in their opener, because only one door carried the directive.
  // Imperative with a narrow skip clause: fully conditional phrasing let the
  // model skip the read-back on 2 of 3 runs; fully unconditional produced a
  // double when it had pre-read. The pre-read is forbidden at the node, so this
  // is the read-back's ONE source. Caller-ID numbers never pass through either
  // door and are never read back.
  function readbackDirective(value: string | undefined): string {
    const readback = value ? phoneReadback(value) : null;
    if (!readback) return '';
    return (
      `\n\nREAD THE NUMBER BACK NOW, digit by digit, before your next question — say ` +
      `exactly: "${readback}" — and wait for a yes. One read-back, one yes: only if ` +
      `you ALREADY read this exact number back and heard their yes, do not repeat it. ` +
      `If they correct it, record_answer again with the corrected number.`
    );
  }

  const record_answer = llm.tool({
    description:
      'Record something the caller said for a checklist item — an answer (value) or that ' +
      'they declined / do not know (declined:true). Call it for EVERYTHING you hear, in any ' +
      'order, several times per turn if they volunteered several things. Record only what ' +
      'they actually said — never an inference.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'The checklist item id, exactly as shown.' },
        value: { type: 'string', description: "The caller's answer, in their words." },
        declined: {
          type: 'boolean',
          description: 'True when they were asked and cannot or will not say.',
        },
      },
      required: ['node_id'],
    },
    execute: (args: { node_id: string; value?: string; declined?: boolean }): Promise<string> =>
      Promise.resolve(runRecordAnswer(args)),
  });

  /**
   * Clean up the two shapes a caller's NAME arrives in that the record cannot
   * use as-is. Both were live defects, both stored verbatim:
   *
   *   "C-A-M-I-L-L-E"              — a correction, SPELLED. Stored letter by
   *                                  letter, so the fix for a wrong name was a
   *                                  differently wrong name (#2).
   *   "Jaya from Connolly Systems" — a person AND their company in one breath.
   *                                  splitName filed "from Connolly System" as
   *                                  a SURNAME (#10).
   *
   * The company half is recorded onto whichever company node this call has
   * open, so the fact is kept rather than discarded — and never guessed at when
   * there is nowhere for it to go.
   */
  const cleanNameValue = (raw: string | undefined): string | undefined => {
    if (!raw) return raw;
    const { name, company } = splitNameAndCompany(raw);
    if (company) {
      for (const nodeId of ['callers_company', 'client_company']) {
        if (tracker.status(nodeId) === 'open' || tracker.status(nodeId) === 'latent') {
          recordIfOpen(nodeId, company);
          break;
        }
      }
    }
    return normalizeSpelledName(name);
  };

  function runRecordAnswer(args: { node_id: string; value?: string; declined?: boolean }): string {
    if (args.node_id === CALLER_NAME && args.value && !args.declined) {
      args = { ...args, value: cleanNameValue(args.value) };
    }
    try {
      tracker.record(args.node_id, { value: args.value, declined: args.declined });
    } catch (err) {
      // The error text IS the corrective instruction — hand it straight back.
      if (err instanceof RecordError || err instanceof UnknownNodeError) return err.message;
      throw err;
    }
    maybeIdentify();
    // If this answer CORRECTS something a completed write already consumed,
    // rewrite that row — the tracker being right is not the same as the record
    // being right (#2, "Jamil").
    rewriteCorrectedWrites(args.node_id);
    // HOST-ENFORCED READ-BACK (2026-07-21): the prompt rule "read a dictated number
    // back exactly once" was skipped on two consecutive live calls — a prompt-tier
    // rule the model ignores twice gets promoted to the runtime. When the recorded
    // value IS a ten-digit phone number, the tool result hands back the exact 3-3-4
    // string to speak, so the read-back is one instruction away instead of one
    // remembered style rule away. (Caller-ID-prefilled numbers never pass through
    // record_answer, so this fires only on genuinely dictated numbers.)
    let directive = repeatGuardDirective(args.node_id) + readbackDirective(args.value);
    if (args.node_id === 'meeting_offer' && args.value === 'wants_meeting') {
      // The offer's YES is a booking ask — and the HOST does the selecting, not
      // the model. First shipped as a directive ("call set_purpose NOW adding
      // booking"); on the very next sim run the model recorded the yes and never
      // made the call — the same shape as the ladder's 2026-07-27 eval failure
      // (offered, took a time, said "you're booked", never called the tool). A
      // tool-result instruction the model can skip is a hope; a selection the
      // host has already made is a fact. Same promotion as the read-back above.
      tracker.select(['identity', 'booking']);
      // A meeting accepted off the job intake already has its topic — the same
      // auto-fill set_purpose does when booking rides along with job.
      if (tracker.selectedTrees().includes('job')) {
        recordIfOpen('meeting_topic', TREE_TOPIC['job']);
      }
      deps.onSelectionChanged();
      directive +=
        '\n\nThey want the meeting — booking is now ON YOUR CHECKLIST. Offer real times ' +
        'next (get_available_slots). Nothing is booked until book_with_scheduling ' +
        'returns success — never say "booked" before it.';
    }
    if (args.node_id === CALLER_NAME && args.value && !args.declined) {
      // 2026-07-21 live call: the caller gave his name and never heard it again
      // until the goodbye. A receptionist who learns a name USES it — nudge at
      // the exact moment it lands, when the acknowledgement is being composed.
      // First name only: "Thanks, Dale." — never "Thanks, Dale DeMott."
      const first = args.value.trim().split(/\s+/)[0];
      directive +=
        `\n\nUse their first name in your acknowledgement right now ("Thanks, ${first}.") ` +
        `and again at natural moments later — confirming the booking, wrapping up. ` +
        `Not every sentence; that reads as salesy.`;
    }
    return stateBlock() + directive;
  }

  const finish_call = llm.tool({
    description:
      "Call when the caller has nothing further ('no thanks', 'that's all'). Speaks the " +
      'goodbye and ends the call. Refuses while the checklist still has open items.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (): Promise<string> => {
      // The gate: a selected-but-unresolved checklist holds the door shut. A
      // call with NO selection may close (wrong number, instant hang-up ask).
      // A selected-but-empty checklist deliberately REFUSES here — a message the
      // caller wanted to leave must not be dropped half-taken. The wrong-business
      // caller escapes not by weakening this gate but by never selecting a tree
      // (or deselecting one) in the first place — see the prompt's WRONG BUSINESS
      // branch and the wrong_trees exit.
      if (tracker.hasSelection() && !tracker.isResolved()) {
        return `Not yet — the checklist is not complete. Finish these first. ${stateBlock()}`;
      }
      // ONE goodbye. closeCall defers session.close() to a macrotask, so a second
      // finish_call can land in the gap and speak a SECOND farewell over the first
      // (2026-07-27 live call SCL_nRKo3KEVw8Yh ended "Nothing else needed… Thanks
      // for calling." / "You're all set… have a great day!" back to back). The
      // first call through this gate owns the goodbye; any repeat is a no-op.
      if (closing) return 'The call is already ending — say nothing further.';
      closing = true;
      // First name only — "You're all set, Dale", never "…, Dale DeMott".
      const name = tracker.value(CALLER_NAME)?.trim().split(/\s+/)[0];
      const goodbye = name
        ? `You're all set, ${name}. Thanks for calling, and have a great day!`
        : `You're all set. Thanks for calling, and have a great day!`;
      await deps.closeCall(goodbye);
      return 'Call complete.';
    },
  });

  const baseTools: llm.ToolContext = { set_purpose, record_answer, finish_call };

  // get_my_appointments — in the toolset EVERY turn, not just when
  // schedule_change is selected (2026-07-30, CALL_IMPROVEMENTS.md #8): a caller
  // claimed her live 2:30 booking and the model — which had NO tool that could
  // check — asserted "you don't have a booked time on file" from silence. The
  // prompt's tool-gated-facts rule needs the tool to actually be there. Plain
  // read-only passthrough: server-side phone-gated (caller-ID / verified spoken
  // number), completes no checklist node, holds no gate.
  const realMyAppointments = realTools['get_my_appointments'];
  if (realMyAppointments) baseTools['get_my_appointments'] = realMyAppointments;

  // RAG — in the toolset EVERY turn (questions arrive anywhere); the result
  // points the model back at the frontier so a digression cannot lose the call.
  const realAnswer = realTools['get_company_policy_answer'];
  if (realAnswer) {
    baseTools['answer_question'] = llm.tool({
      description:
        "Answer the caller's question about the business from the knowledge base — hours, " +
        'pricing, services, policies, background. Usable at ANY moment, mid-anything. Answer ' +
        'in one or two spoken sentences from the result ONLY; if it has no answer, say so ' +
        'honestly and offer to take a message or set up a time with the owner.',
      parameters: shape(realAnswer).parameters,
      execute: async (args: unknown, toolCtx: unknown): Promise<string> => {
        const raw = await shape(realAnswer).execute(args, toolCtx);
        const open = tracker.frontier();
        const back = open.length
          ? `\n\n(Answer briefly, then return to the checklist — next open: ${open[0].node_id}.)`
          : '';
        return `${typeof raw === 'string' ? raw : JSON.stringify(raw)}${back}`;
      },
    });
  }

  /**
   * Merge the model's args with the tracker's recorded answers. Model-provided
   * values always win; everything else is filled from host-owned state (the
   * 2026-07-21 lesson: a write that ignores what the checklist holds is state
   * theater). Extracted so a CORRECTION re-fire builds its args exactly the way
   * the original write did — a second code path here would be a second set of
   * bugs.
   */
  const buildActionArgs = (toolName: string, args: unknown): Record<string, unknown> => {
    const provided: Record<string, unknown> = {
      ...((args as Record<string, unknown> | null) ?? {}),
    };
    for (const f of ACTION_ARG_BACKFILL[toolName] ?? []) {
      const cur = provided[f.arg];
      if (cur !== undefined && cur !== null && cur !== '') continue;
      delete provided[f.arg];
      for (const nodeId of f.from) {
        const v = tracker.value(nodeId);
        if (v === undefined || v === '') continue;
        const mapped = f.map ? f.map(v) : v;
        if (mapped !== undefined) {
          provided[f.arg] = mapped;
          break;
        }
      }
    }
    return provided;
  };

  /**
   * A CORRECTION REACHES THE ROW THAT WAS ALREADY WRITTEN.
   *
   * "You got my name wrong… Camille, C-A-M-I-L-L-E" arrived thirty seconds
   * after take_message had saved the row as Jamil. record_answer updated the
   * tracker, the agent said thank you, and the row never changed — it still
   * says Jamil in prod (CALL_IMPROVEMENTS.md #2). Re-fire the landed write with
   * the corrected values; take_message upserts on (tenant_id, call_id), so this
   * rewrites its own row rather than appending a contradiction.
   *
   * On a MACROTASK, and fire-and-forget: this runs inside record_answer's own
   * execute, and a correction must never make the model wait on a backend
   * round-trip — nor fail the answer it just recorded if that round-trip dies.
   */
  const rewriteCorrectedWrites = (nodeId: NodeId): void => {
    for (const site of actionSites.values()) {
      const sources = REWRITABLE_ON_CORRECTION[site.def.tool];
      if (!sources?.includes(nodeId)) continue;
      if (tracker.status(site.def.node_id) !== 'done') continue;
      const real = realTools[site.def.tool];
      if (!real) continue;
      const toolName = site.def.tool;
      setTimeout(() => {
        void (async () => {
          try {
            await shape(real).execute(buildActionArgs(toolName, {}), undefined);
            getLogger().info(
              { event: 'checklist_correction_rewrite', tool: toolName, node_id: nodeId },
              'corrected answer re-applied to the write it had already landed in'
            );
          } catch (err: unknown) {
            getLogger().warn(
              {
                event: 'checklist_correction_rewrite_failed',
                tool: toolName,
                node_id: nodeId,
                err: String(err),
              },
              'correction could NOT be re-applied — the stored row still holds the old value'
            );
          }
        })();
      }, 0);
    }
  };

  const wrapAction = (site: ActionSite): llm.ToolContext[string] => {
    const { def } = site;
    const real = realTools[def.tool];
    const idField = ACTION_ID_FIELDS[def.tool] ?? 'id';
    return llm.tool({
      description: shape(real).description,
      parameters: shape(real).parameters,
      execute: async (args: unknown, toolCtx: unknown): Promise<string> => {
        const status = tracker.status(def.node_id);
        if (status === 'done') {
          // The anti-double-book gate (2026-07-21 live call: booked, forgot,
          // denied it, booked again). A landed write refuses a repeat.
          return (
            `ALREADY DONE this call — ${def.description} succeeded earlier. Do NOT repeat ` +
            `it, and never say it has not happened. ${stateBlock()}`
          );
        }
        if (status === 'blocked') {
          return `Not yet — first resolve: ${tracker.unmet(def.node_id).join(', ')}. ${stateBlock()}`;
        }
        if (status === 'not_applicable' || status === 'latent' || status === 'unselected') {
          return `That action is not applicable right now. ${stateBlock()}`;
        }
        // Backfill omitted args from the tracker's recorded answers (see
        // ACTION_ARG_BACKFILL) — model-provided values always win.
        const provided = buildActionArgs(def.tool, args);
        const raw = await shape(real).execute(provided, toolCtx);
        const id = extractSuccessId(raw, idField);
        const rawText = typeof raw === 'string' ? raw : JSON.stringify(raw);
        if (id) {
          tracker.completeAction(def.node_id, id);
          failCounts.delete(def.node_id);
          return `${rawText}\n\n${stateBlock()}`;
        }
        // A miss stays open (safe direction) — but a hard-down backend must not
        // become an infinite re-offer loop (rule 15): after 2 straight failures
        // the advice changes to "stop and take a message".
        const failures = (failCounts.get(def.node_id) ?? 0) + 1;
        failCounts.set(def.node_id, failures);
        const advice =
          failures >= ACTION_FAILURE_LIMIT
            ? `\n\nThis has failed ${failures} times in a row — STOP retrying it. Offer to ` +
              'take a message instead (add the message tree with set_purpose if needed).'
            : '';
        return `${rawText}${advice}`;
      },
    });
  };

  const selectedTools = (): llm.ToolContext => {
    const tools: llm.ToolContext = { ...baseTools };
    for (const treeId of tracker.selectedTrees()) {
      for (const site of actionSites.values()) {
        if (site.treeId === treeId && realTools[site.def.tool] && !tools[site.def.tool]) {
          tools[site.def.tool] = wrapAction(site);
        }
      }
      for (const name of TREE_PASSTHROUGH_TOOLS[treeId] ?? []) {
        if (realTools[name] && !tools[name]) tools[name] = realTools[name];
      }
    }
    return tools;
  };

  return { selectedTools };
}
