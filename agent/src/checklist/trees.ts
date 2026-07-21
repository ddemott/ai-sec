/**
 * THE PLATFORM TREE LIBRARY — question-tree phase 2
 * (docs/QUESTION_TREE_ARCHITECTURE.md §3.1, §4.2).
 *
 * Every tree the purpose selector can hand a call. Typed TS rather than loose
 * JSON on purpose: the compiler checks every node against types.ts, and
 * trees.test.ts constructs a real ChecklistTracker from this exact library — so
 * a malformed tree is a red CI, never a mid-call surprise. (Per-tenant tree
 * delivery via tenant-config is deferred until a real tenant needs a tree the
 * platform doesn't have — build for real customers.)
 *
 * DESCRIPTIONS ARE FOR THE PURPOSE SELECTOR. The model reads them to decide
 * which trees a caller's opener selects, so they carry the hard-won intent
 * boundaries (PR #288: "can someone fix my computer" is a SERVICE REQUEST, not
 * a job inquiry — the "job" there is work the caller wants done, not a role for
 * the owner).
 *
 * ASK TEXT IS FOR THE MODEL, NEVER READ VERBATIM. Where a question has
 * live-call-paid-for rules (the phone read-back), the rules ride in the ask.
 *
 * COMPOSITION OVER DUPLICATION: trees do not embed each other. A repair call
 * that should end in a booking selects identity + fix_computer + booking; the
 * shared node ids (caller_name, caller_phone) merge to one node each.
 */
import type { QuestionTreeDef } from './types.js';

/** Shared node ids — every tree that wants these MUST use these exact ids so
 *  the merge dedupes them (tracker enforces type agreement at construction). */
export const CALLER_NAME = 'caller_name';
export const CALLER_PHONE = 'caller_phone';

const callerNameNode = {
  node_id: CALLER_NAME,
  type: 'text',
  ask:
    'the name the caller used for themselves — however it arrived ("this is Mike from Apex", ' +
    'or third-person "tell him Mike called, my number is…" — that "my" makes Mike the caller). ' +
    'The name they used IS their name: never chase a surname or a "full name", and never ask ' +
    'for a name they already spoke',
} as const;

const callerPhoneNode = {
  node_id: CALLER_PHONE,
  type: 'text',
  ask:
    'the best callback number. Read it back ONCE — digit by digit, three groups (3-3-4), ' +
    'no "+1" — and ask if it is right, then STOP and wait for the yes. One read-back, one ' +
    'yes, never more: a number they just dictated needs exactly one confirmation, and a ' +
    'ten-digit number is complete — never ask for "the rest" of it. If they say the number ' +
    'you have (caller ID) is wrong, drop it entirely and collect fresh — never argue, never ' +
    'repeat the disputed number',
} as const;

/** WHO IS THIS — the floor under every goal that needs a contact. */
export const IDENTITY_TREE: QuestionTreeDef = {
  tree_id: 'identity',
  description:
    'Who is calling and how to reach them. Select for EVERY call whose goals need a contact ' +
    '(a booking, a message, a role, a schedule change). Skip ONLY for pure questions-only ' +
    'calls — a caller asking "when are you open?" is answered, never interrogated for a name.',
  nodes: [callerNameNode, callerPhoneNode],
};

/** THE MEETING — always the primary goal when present. */
export const BOOKING_TREE: QuestionTreeDef = {
  tree_id: 'booking',
  description:
    'The caller wants time with someone here — a meeting, appointment, call, viewing, or ' +
    'demo, even mentioned in passing. Also the tree for a SERVICE REQUEST that ends in a ' +
    'visit. The meeting is what they rang for: give this tree priority over intake questions.',
  nodes: [
    {
      node_id: 'meeting_topic',
      type: 'text',
      ask:
        'what the meeting is about, in the CALLER\'S OWN WORDS ("a meeting to talk about a ' +
        'job position") — the system matches their words to the right service, so record the ' +
        'words and let it choose',
    },
    {
      node_id: 'book',
      type: 'action',
      tool: 'book_with_scheduling',
      description: 'book the meeting — offer real open times, settle one, book it',
      requires: [CALLER_NAME, CALLER_PHONE, 'meeting_topic'],
    },
  ],
};

/** A MESSAGE — the universal catch-all write. */
export const MESSAGE_TREE: QuestionTreeDef = {
  tree_id: 'message',
  description:
    'The caller wants to leave a message, have the owner call back, or pass something along ' +
    'that a booking or a role does not cover. Leaving a message stays a message even when ' +
    'it MENTIONS a job or a callback.',
  nodes: [
    callerNameNode,
    {
      node_id: 'message_body',
      type: 'text',
      ask: 'the message itself, in their words — what they want the owner to know or do',
    },
    {
      node_id: 'take_message_action',
      type: 'action',
      tool: 'take_message',
      description: 'save the message so the owner actually receives it',
      requires: [CALLER_NAME, 'message_body'],
    },
  ],
};

/** THE ELSE — a topic no specific tree covers ("a message about a wedding"). */
export const GENERIC_SUBJECT_TREE: QuestionTreeDef = {
  tree_id: 'generic_subject',
  description:
    "The caller's topic has no specific tree (a wedding, an invoice, anything). Pairs with " +
    'the message or booking tree so EVERY topic has questions and a way to finish — no ' +
    'caller ever falls into a hole where the AI has nothing to ask.',
  nodes: [
    {
      node_id: 'subject_details',
      type: 'text',
      ask:
        'what this concerns, in their own words — enough detail that the owner reads it and ' +
        'knows exactly what the call was about',
    },
  ],
};

/** QUESTIONS — RAG-answered; the tree only marks "they got what they came for". */
export const QA_TREE: QuestionTreeDef = {
  tree_id: 'qa',
  description:
    'The caller has questions about the business — hours, pricing, services, policies, ' +
    'location, background/experience. Answers come from the knowledge base tool, NEVER from ' +
    'memory. A questions-only caller gets answers immediately, with no identity questions first.',
  nodes: [
    {
      node_id: 'qa_summary',
      type: 'text',
      ask:
        'record ONLY once their questions are answered and they confirm they have what they ' +
        'need: a one-line summary of what they asked about (it becomes the call record)',
    },
  ],
};

/**
 * A JOB brought TO the owner — the Thinking Hammer vertical. Ported from the
 * rung-era intake (jobIntakeTask.ts): the two-companies rule, the
 * contract/full-time fork, the onsite/remote fork. Dale's contract_to_hire
 * option (2026-07-21 design) added as the third employment fork.
 */
export const JOB_TREE: QuestionTreeDef = {
  tree_id: 'job',
  description:
    'The caller is BRINGING a job, role, contract position, or hiring opportunity TO the ' +
    'owner — a recruiter, staffing agency, or someone pitching work for the owner to take. ' +
    'NOT a caller asking the business to do work for THEM ("can someone fix my computer" is ' +
    'a service request → booking/fix_computer, even if they call it "a job").',
  nodes: [
    {
      node_id: 'callers_company',
      type: 'text',
      ask:
        'the company the CALLER works for — their own employer or staffing agency. Ask ' +
        '"which company are you calling from?" EVEN IF they already named a client, because ' +
        "the client is a DIFFERENT company. The client's name never goes here",
    },
    {
      node_id: 'hiring_for',
      type: 'choice',
      ask:
        'are they hiring for their OWN company, or PLACING someone with a client? Two ' +
        'separate companies must never collapse into one — the owner needs to know who ' +
        'called AND where the work is',
      options: {
        own_company: [], // the work is at their own company — never re-ask which
        placing_with_client: [
          {
            node_id: 'client_company',
            type: 'text',
            ask: "which company the work would ACTUALLY be for — different from the caller's",
          },
        ],
      },
    },
    {
      node_id: 'role_description',
      type: 'text',
      ask: "the role itself, in the caller's own words — title, tech, whatever they lead with",
    },
    {
      node_id: 'employment_type',
      type: 'choice',
      ask: 'contract, full time, or contract-to-hire?',
      options: {
        contract: [
          { node_id: 'rate_range', type: 'text', ask: 'the rate range' },
          { node_id: 'contract_length', type: 'text', ask: 'the length of the contract' },
        ],
        full_time: [{ node_id: 'salary_range', type: 'text', ask: 'the salary range' }],
        contract_to_hire: [
          // rate_range is shared with the contract branch — one question, two
          // paths to relevance; an early "it pays 65 to 80" survives either answer.
          { node_id: 'rate_range', type: 'text', ask: 'the rate range' },
          {
            node_id: 'conversion_terms',
            type: 'text',
            ask: 'the conversion terms — how long until it converts to full time',
          },
        ],
      },
    },
    {
      node_id: 'work_mode',
      type: 'choice',
      ask: 'onsite, remote, or hybrid?',
      options: {
        onsite: [{ node_id: 'position_address', type: 'text', ask: 'the address of the position' }],
        hybrid: [{ node_id: 'position_address', type: 'text', ask: 'the address of the position' }],
        remote: [
          {
            node_id: 'team_timezone',
            type: 'text',
            ask: 'the timezone, so the owner knows the office hours',
          },
        ],
      },
    },
    {
      node_id: 'capture',
      type: 'action',
      tool: 'capture_job_inquiry',
      description: 'record the role for the owner — the write that makes the lead real',
      // Declined answers SATISFY these (2026-07-21 live call: three declines,
      // capture still landed); the tool's own refuse-gate stays authoritative.
      requires: ['callers_company', 'hiring_for', 'employment_type'],
      // Finish the WHOLE intake before the write: the first mock call fired
      // capture with contract length / work mode / timezone still uncollected.
      await_tree: true,
    },
  ],
};

/** CHANGE an existing appointment — cancel or move, never book-new. */
export const SCHEDULE_CHANGE_TREE: QuestionTreeDef = {
  tree_id: 'schedule_change',
  description:
    'The caller wants to CANCEL or RESCHEDULE an appointment they ALREADY have. Booking a ' +
    'NEW time is the booking tree; changing an existing one is this tree — a reschedule is ' +
    'the latter.',
  nodes: [
    {
      node_id: 'change_type',
      type: 'choice',
      ask: 'do they want to cancel the appointment, or move it to another time?',
      options: {
        cancel: [
          {
            node_id: 'cancel_action',
            type: 'action',
            tool: 'cancel_appointment',
            description: 'cancel the appointment they named',
            requires: [CALLER_PHONE],
          },
        ],
        reschedule: [
          {
            node_id: 'reschedule_action',
            type: 'action',
            tool: 'reschedule_appointment',
            description: 'move the appointment to a new open time',
            requires: [CALLER_PHONE],
          },
        ],
      },
    },
  ],
};

/**
 * DRAFT — the computer-repair vertical. The branch details are STILL OPEN WITH
 * DALE (drop-off vs in-home service area, durations, homeowner-vs-resident);
 * this stub collects what is safe to collect today and composes with the
 * booking tree for the visit itself. Flesh out before any live call routes here.
 */
export const FIX_COMPUTER_TREE: QuestionTreeDef = {
  tree_id: 'fix_computer',
  description:
    'The caller wants THEIR computer or tech looked at, fixed, or built BY us — a service ' +
    'request ("my laptop won\'t boot", "can someone fix my computer"). Even if they say ' +
    '"job", work the caller wants done is THIS, never the job tree. Compose with identity + ' +
    'booking so the repair ends with a scheduled visit or drop-off.',
  nodes: [
    {
      node_id: 'issue_description',
      type: 'text',
      ask: "what's wrong, in the caller's own words — device, symptom, when it started",
    },
    {
      node_id: 'service_mode',
      type: 'choice',
      ask: 'would they rather drop it off, or have someone come to them?',
      options: {
        drop_off: [],
        in_home: [
          {
            node_id: 'service_address',
            type: 'text',
            ask: 'the address the visit would be at (service-area rules TBD with the owner)',
          },
        ],
      },
    },
  ],
};

/** The library every call starts from, in canonical selection-render order. */
export const PLATFORM_TREE_LIBRARY: QuestionTreeDef[] = [
  IDENTITY_TREE,
  BOOKING_TREE,
  MESSAGE_TREE,
  GENERIC_SUBJECT_TREE,
  QA_TREE,
  JOB_TREE,
  SCHEDULE_CHANGE_TREE,
  FIX_COMPUTER_TREE,
];
