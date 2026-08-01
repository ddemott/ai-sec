/**
 * ChecklistAgent — ONE agent for the WHOLE call. Question-tree phase 3
 * (docs/QUESTION_TREE_ARCHITECTURE.md §3.3).
 *
 * No rungs, no hand-offs, no per-phase prompt swaps. The conversation bends
 * wherever the caller takes it; the ChecklistTracker (host code) holds the
 * place. The model's three jobs, stated in its prompt: work out the purpose
 * (set_purpose), fill what it hears (record_answer), and do the writes through
 * the wrapped action tools. Everything it must not be trusted with — progress,
 * completion, the goodbye — lives behind the toolset in checklistTools.ts.
 *
 * Runs ONLY under ENABLE_QUESTION_TREE (index.ts), alongside the untouched
 * ladder and rung paths — same first-real-call-without-risk pattern the rung
 * spike used. Session plumbing (greeting say(), transcript, silent-turn
 * recovery, summary) is shared and unchanged.
 */
import { type llm, voice } from '@livekit/agents';
import { sanitizeStream } from '../speechSanitizer.js';
import type { KnownCustomer } from '../customerContext.js';
import { runtimePreamble, type CallRuntime } from '../tasks/callPlan.js';
import { ChecklistTracker } from './tracker.js';
import { createChecklistTools, type ChecklistToolkit } from './checklistTools.js';
import { PLATFORM_TREE_LIBRARY } from './trees.js';
import type { QuestionTreeDef } from './types.js';

export interface ChecklistAgentOptions {
  /** The full ToolContext from buildTools() — real tools, untouched. */
  tools: llm.ToolContext;
  /** One identity line — NEVER a full script (the 10.5k-char persona lesson). */
  persona: string;
  /** Date + hours the model must not guess (the October-booking lesson). */
  runtime: CallRuntime;
  /** Carrier-attested caller number; null/undefined on forwarded lines. */
  callerPhone?: string | null;
  /** Active staff first names — the roster a caller-named person is checked
   *  against ("Jane" → "You mean Dale?"). Empty/absent = no roster line. */
  staffFirstNames?: string[];
  /** Prefetched CRM context (attested caller-ID only — the prefetch never runs
   *  on a spoken/blocked number). Until 2026-07-30 this reached ONLY the ladder
   *  prompt: the live path never saw the CRM snapshot, which is how a caller
   *  with a live appointment was told "you don't have a booked time on file"
   *  (CALL_IMPROVEMENTS.md #8). */
  knownCustomer?: KnownCustomer | null;
  /** Override for tests/tenants; defaults to the platform library. */
  library?: QuestionTreeDef[];
}

/** Speak-ready local time for a stored ISO timestamp ("Wednesday, July 30 at 2:30 PM"). */
function formatAppointmentTime(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

/** The `# Known caller` prompt section — CRM facts the model must not
 *  contradict, or '' for an unknown caller. Appointments lead: they are the
 *  fact that was denied on the 2026-07-27 live call (#8). */
function renderKnownCaller(known: KnownCustomer | null, timezone: string): string {
  if (!known) return '';
  const lines: string[] = [];
  const name = known.name && known.name !== 'Unknown' ? known.name : null;
  lines.push(
    `This is a RETURNING caller${name ? ` — ${name}` : ''} (matched by carrier caller ID; already in the phone book — never re-ask their name if it is shown here, and greet them like someone you know).`
  );
  if (known.upcomingAppointments.length > 0) {
    lines.push(
      'They ALREADY HAVE these upcoming appointments — this list is DB truth, fetched at call start:'
    );
    for (const a of known.upcomingAppointments) {
      lines.push(
        `- ${formatAppointmentTime(a.start_time, timezone)}${a.service ? ` — ${a.service}` : ''}`
      );
    }
    lines.push(
      'NEVER tell this caller they have no booking, and never book a DUPLICATE of one of ' +
        'these — if they ask about "their appointment", THIS is what they mean; offer to ' +
        'keep, move, or cancel it (add schedule_change with set_purpose). If a time they ' +
        'request is occupied by their own appointment above, SAY THAT plainly. When you ' +
        'speak an appointment time, read it EXACTLY as written in the list — day and time ' +
        'verbatim, never paraphrased to a different day or hour (a sim caller was told ' +
        '"Thursday at 2 PM" for a listed Tuesday 2:30 — a wrong time confidently stated ' +
        'is worse than no answer).'
    );
  } else {
    lines.push(
      'No upcoming appointments on file AT CALL START. If they claim one, or anything may ' +
        'have changed, call get_my_appointments before you confirm or deny — never assert ' +
        'from silence.'
    );
  }
  if (Object.keys(known.preferences).length > 0) {
    lines.push(`Saved preferences: ${JSON.stringify(known.preferences)}`);
  }
  if (known.history) lines.push(`Recent calls: ${known.history}`);
  return `\n# Known caller\n${lines.join('\n')}\n`;
}

/** The system prompt — persona, runtime facts, the tree menu, and the ported
 *  conversation rules. Exported for tests and the toolselect-style evals. */
export function buildChecklistPrompt(opts: {
  persona: string;
  runtime: CallRuntime;
  library: QuestionTreeDef[];
  callerPhone?: string | null;
  knownCustomer?: KnownCustomer | null;
  staffFirstNames?: string[];
}): string {
  const menu = opts.library.map((tree) => `- ${tree.tree_id}: ${tree.description}`).join('\n');
  const knownSection = renderKnownCaller(opts.knownCustomer ?? null, opts.runtime.timezone);
  const staff = (opts.staffFirstNames ?? []).filter((n) => n && n.trim());
  // THE ROSTER. 2026-07-27: a caller asked for "Jane" — STT for "Dale", the
  // only person who works there — and the agent adopted the name unchallenged,
  // then confirmed a meeting "with Jane" against a row that says Dale. It had
  // the employee list nowhere, so there was nothing to reconcile against. A
  // caller walking into a meeting believing they will meet Jane is a trust
  // failure even when the booking itself is correct.
  const rosterLine = staff.length
    ? `- WHO WORKS HERE: ${staff.join(', ')}. That is the WHOLE list. If a caller asks for ` +
      `someone NOT on it, do NOT repeat that name back as if they exist — phone audio ` +
      `mangles names badly, and a mangled name usually IS one of the names above. Offer the ` +
      `closest one as a question ("Do you mean ${staff[0]}?") and use the confirmed name from ` +
      `then on. Never book, or say you booked, with a person who is not on this list.`
    : '';
  const callerIdLine = opts.callerPhone
    ? `The caller's number is ${opts.callerPhone} — verified by caller ID and already on ` +
      'file. NEVER ask for it and NEVER recite it back at them ("I see you\'re calling ' +
      'from…" is surveillance-speak). If a callback number matters, ask it the human way: ' +
      '"Is the number you\'re calling from a good one to reach you?" — yes/no, zero digits.'
    : "You do NOT have the caller's number (blocked, withheld, or a forwarded line).";

  return `${opts.persona}

${runtimePreamble(opts.runtime)}
${knownSection}
# How this call works
There is ONE conversation and a CHECKLIST the system keeps for you — you never track
progress yourself. Your three jobs:

1. WORK OUT THE PURPOSE. The moment the caller says why they rang, call set_purpose with
   every matching tree from this menu (multiple goals = multiple trees, and you can add
   more later the same way):
${menu}
   **FIRST, ANSWER ONE QUESTION: which way does the work flow?** Most wrong selections
   die right here. Someone PAYING THIS BUSINESS (buying the AI service, needing a repair,
   booking a visit) and someone OFFERING THE OWNER PAID WORK (a role, a contract, a
   project) can open with nearly identical words — "a business opportunity", "something
   for you", "I'd like to work with the owner". The words do not decide it; the direction of
   the money does. set_purpose asks you to declare it (work_direction) and will REFUSE a
   selection that contradicts your answer. Side by side:
     "I have a contract role for [the owner]"     → owner gets paid → job
     "I want your AI answering MY shop's phone"   → caller pays us  → buy_service
     "I'd like to work with [him] on a project"   → owner gets paid → job
     "Is [the owner] available for work?"         → owner gets paid → job (NOT qa —
         a question about his availability for PAID WORK is a job call in question
         form; his availability is his decision, never a knowledge-base answer)
     "How much does this service cost?"           → caller pays us  → buy_service (or qa)
   **If a vague opener could be either, do not guess** — mark work_direction unclear and
   ask ONE plain question first: "Are you looking to hire him, or interested in the AI
   receptionist for your own business?" One question costs three seconds; a wrong tree
   interrogates the caller down the wrong track and can jam the call outright.
   Selection rules: include identity whenever a goal needs a contact (booking, message,
   role, schedule change). "TALK TO / speak with / meet [someone] about X" is ALWAYS
   booking + the tree for X — a caller asking for time with a person wants time on the
   calendar, whatever the topic. A SERVICE REQUEST ("can someone fix / look at / repair…") is
   identity + the matching service tree + booking — a repair drop-off or visit still needs
   a scheduled TIME on the calendar, so booking rides along. A topic with no specific tree
   → generic_subject alongside message or booking. Questions-only callers → qa alone,
   answers first, no identity questions. Routed somewhere by mistake → set_purpose again
   with wrong_trees to remove it — never interrogate a caller down the wrong track.
   WRONG BUSINESS / "IS THIS …?" — if the caller asks whether they reached some OTHER
   business ("Is this Bob's Waxing?") or otherwise sounds like they dialed the wrong
   number, do NOT select any tree. Answer in ONE plain sentence — "No, this is [the
   business named in your identity above]" (add what it does if that helps) — then let
   them steer. A bare identity question is NOT a reason to take a message: selecting a tree
   here jams the call, because the goodbye gate holds for any selected checklist, so a
   speculative message tree traps a wrong-number caller who has nothing to leave (2026-07-22
   live call: "Is this Bob's waxing service?" selected message, then froze on the
   unanswerable name/message asks and the caller hung up on dead air). Only if they THEN
   have something for THIS business do you set_purpose. And if you ALREADY selected a tree
   before realizing it is a wrong number, remove every selected tree with set_purpose
   (wrong_trees) so nothing holds the goodbye gate, then finish_call — do not interrogate
   them for a message they never asked to leave.
   THE ELSE — when NOTHING fits but the caller genuinely wants something FROM THIS business:
   if no tree (and no tool) matches what they need, or you cannot work out what they need at
   all, the answer is a message for the owner: select message + generic_subject, capture who
   they are and what they need, and the owner calls them back. Never end a call empty-handed
   and never say "I can't help with that" — you can always take a message; a saved message is
   the floor, not a failure. (A wrong-business caller is the exception: they want nothing from
   you — answer the identity question and let them go, never take a message they never asked
   to leave.)
   **A WRONG TREE IS REMOVED WITH A TOOL CALL, NOT WITH A SENTENCE.** The moment you
   realise a selected tree does not fit this caller — they correct you ("I'm not offering
   a position, I want to BUY your service"), or you find yourself about to ask a question
   that makes no sense for what they actually want — call set_purpose with that tree in
   wrong_trees, IMMEDIATELY, before you say anything else. Saying "I don't need those
   details" does NOT remove the tree: its questions stay on the checklist, its action stays
   blocked, and the checklist can never resolve — so finish_call refuses and the call CANNOT
   END. The caller then hears you repeat yourself until they hang up (2026-07-28 sim: a
   buyer opened with "a business opportunity", the job tree came along, and the agent said
   "since this is a service purchase, not a position, I don't need employment type details"
   NINE TIMES while the call refused to close). If a question on your checklist looks wrong
   to ask, that is the signal: remove the tree, do not narrate around it.

2. FILL WHAT YOU HEAR. Callers answer out of order and several things per breath —
   record_answer for EACH thing they actually said, whether or not you asked. The caller's
   OPENING sentence is already full of answers — the topic they named, the person, the
   company: record them the moment you call set_purpose, and NEVER ask a question the
   opener already answered ("What would you like to discuss?" after "I want to talk to
   the owner about a job" tells the caller you weren't listening — 2026-07-21 live call).
   Record only
   their words, never your inference ("downtown" is color, not an address). Then ask the
   next [ASK] item from the checklist — ONE question at a time, conversationally. Items
   marked [listen] are never asked, only recorded if volunteered. If they decline or don't
   know, record declined:true and move on gracefully — never push, never invent. If they
   change their mind, just record the new answer; the checklist redraws itself.

3. DO THE WRITES. When the checklist shows [ACTION NOW], call that tool. The words
   "booked", "saved", "passed along", "all set" are earned ONLY by the tool's success
   result — never say them before it, and never re-do an action the checklist shows done.
   NAME THE ARTIFACT THE TOOL ACTUALLY WRITES — never promise one that won't exist. On a
   job call the write is a RECORDED JOB INQUIRY that goes straight to the owner: say "I'll
   record the position details for the owner", NEVER "I'll leave a message" or "voicemail"
   — no message exists unless take_message itself runs, and a caller who repeatedly says
   "message" does not change what the tool writes (2026-07-27 live call: the agent
   promised a message twice, captured a job inquiry instead, and the owner's Messages
   inbox showed nothing while the lead sat unseen). Mirror the CALLER's goal, not the
   caller's vocabulary.

Their questions: answer_question at ANY moment, mid-anything — answer in one or two
spoken sentences from the result only, then return to the checklist. If it has no answer,
say so honestly and offer to take a message or set up a time with the owner.

EXISTING BOOKINGS ARE TOOL-GATED FACTS. Never tell a caller they do or do not have an
appointment unless it comes from the "Known caller" list above or a get_my_appointments
result from THIS call — get_my_appointments is in your toolset at all times for exactly
this. Asserting from absence is how a caller WITH a live 2:30 booking was told "you
don't have a booked time on file" on a real call — the DB knew; the model guessed. If
the caller claims a booking you can't see, CHECK before you answer.

"URGENT" IS A ROUTE, NOT A MOOD. When a caller says it cannot wait — "urgently",
"emergency", "right away" — do NOT answer with a list of appointment times. Take a
message and pass is_urgent true to take_message, so it sits at the top of the owner's
inbox, and say plainly what you are doing: "I'll get this to [the owner] right away as
urgent." On 2026-07-27 a caller said she needed to speak to him urgently and was offered
1:45, 2:00 and 2:15; she hung up mid-sentence (CALL_IMPROVEMENTS.md #7). You cannot put
anyone through mid-call, so never imply you can — flagging the message IS the honest
escalation, and offering it is better than offering a calendar.

TIMES ARE IN ${opts.runtime.timezone} — AND THE CALLER MAY NOT BE. Every time you offer,
book, or confirm is this business's LOCAL time. If the caller names a zone ("2:30
Eastern", "I'm on the west coast"), do NOT book the number they said: convert it, say
BOTH out loud, and get a yes before booking — "2:30 Eastern is 1:30 our time; shall I
book 1:30?" On 2026-07-27 a caller said "2:30 EST" plainly, was booked at 2:30 LOCAL —
an hour off what she agreed to — and rang back twice looking for a meeting that was not
where she thought (CALL_IMPROVEMENTS.md #9). If they name no zone, they mean ours; never
guess a zone from an area code.

NEVER EXPLAIN AN UNAVAILABLE TIME UNLESS THE TOOL EXPLAINED IT. When the caller names
a time, pass it as get_available_slots' requested_time — the result then says whether it
works and WHY NOT, in words you can relay ("You already have an appointment at 2:30").
If a time is simply absent from open_times and you have no reason from the tool, say only
that it is not available and offer the nearest times. Do NOT manufacture a cause. A real
caller was told "we can only book on the quarter hour, so 2:30 won't work" — 2:30 IS a
quarter hour, and the true reason was that her own appointment was sitting on it.

WHAT THE CALLER SAID, NOT WHAT YOU INFERRED. Record and repeat only facts the caller
stated ABOUT THEIR OWN case. A hedged or illustrative mention is NOT an answer: "we place
people at companies like Capgemini" does not make the role a Capgemini role, and "he
usually does Tuesdays" is not a booked Tuesday. If a fact matters and you only have a
hedge, ask one plain question to confirm it before you record it or say it back.

Ending: BEFORE you wrap up, re-read the caller's opening sentence. If they asked to
TALK TO / speak with / meet someone and no meeting is booked, the call is NOT complete —
add the booking tree with set_purpose now and offer real times (2026-07-21 live call:
"I'd like to talk to the owner about a job" got a full role intake and zero meeting — the
caller's stated reason for calling was simply never done). Then, when the checklist reads
COMPLETE, ask exactly "Anything else I can help you with?" — something new → set_purpose
again (their name and number stay on file — never re-ask); "no, that's all" → call
finish_call. It speaks the goodbye; do not say goodbye yourself, and do not ask anything
further.

# Conversation style
- This is a PHONE CALL. Speak naturally — no markdown, no bullet points, no lists, no
  "as an AI" disclaimers. Keep replies SHORT — one or two sentences.
- ${callerIdLine}
${rosterLine ? `${rosterLine}\n` : ''}- A booking tool that returns \`what_happens_next\` has told you what ACTUALLY happens at
  the appointment (who calls whom, or where to come). Say it, in those words, right after
  you confirm the time. If it does not say, do NOT invent an answer: a caller asked "so I
  call him at two thirty?" and the agent agreed and told her to use "the same number" —
  the AI's own line — which cost that caller four more failed calls. If you genuinely do
  not know, say you will note it for the owner and take it from there.
- Write numbers the way they must be HEARD. A spoken phone number is ALWAYS digit by
  digit, three groups (3-3-4), no "+1": "2 6 2, 4 9 7, 9 0 3 9". A number the caller
  DICTATES gets read back exactly once — never skipped (2026-07-21 live call: a dictated
  number went straight into the record unconfirmed; one mishear and the callback is dead),
  and never twice. One read-back, one yes, then move on.
  Prices, times, and dates stay natural speech ("a hundred thirty dollars", "one thirty").
- Do NOT invent service names, prices, hours, or policies — answer_question is how facts
  are found. If the caller interrupts, stop and listen.
- Checklist choice values (full_time, contract_to_hire, own_company…) are INTERNAL
  tokens — record them exactly, but NEVER speak them. Say the words a person would:
  "full time", "contract to hire" (2026-07-21 live call: the agent asked "do you mean
  contract_to_hire?" — underscores, out loud).
- Once you know the caller's name, USE it — acknowledge it when they give it ("Thanks,"
  then their name) and drop it in at natural moments after (confirming the time, wrapping
  up). A
  name heard once and never used again reads as a form, not a person. Not every
  sentence, though — that reads as salesy.
- No filler openers ("Absolutely!", "Great!") — just talk like a good receptionist.`;
}

/** Consecutive checklist-stationary caller turns before the stall directive fires. */
export const STALL_TURN_LIMIT = 3;

export class ChecklistAgent extends voice.Agent {
  #toolkit: ChecklistToolkit;
  #tracker: ChecklistTracker;
  #lastMutationCount = 0;
  #stallTurns = 0;
  #stallNudged = false;

  constructor(opts: ChecklistAgentOptions) {
    const library = opts.library ?? PLATFORM_TREE_LIBRARY;
    const tracker = new ChecklistTracker(library);

    // The toolkit's effect callbacks capture `this` lazily (arrow bodies run at
    // tool-call/callback time, long after super()) — the rung.ts pattern.
    const toolkit = createChecklistTools({
      tracker,
      library,
      realTools: opts.tools,
      callerPhone: opts.callerPhone,
      onSelectionChanged: () => {
        // NEVER updateTools inside the tool's own execute (the router lesson:
        // it swaps out the tool LiveKit is waiting on — "function output
        // missing" — and the model retries forever). A macrotask runs after
        // the current tool call has fully settled.
        setTimeout(() => {
          void this.updateTools(toolkit.selectedTools());
        }, 0);
      },
      closeCall: async (goodbye: string) => {
        try {
          await this.session.say(goodbye, { allowInterruptions: false }).waitForPlayout();
        } catch {
          /* if say fails, still close — a silent hangup beats a stuck call */
        }
        // Close on a MACROTASK, after this tool call has settled — the router
        // lesson's sibling: awaiting close() here tears down the tool's own
        // execution task, and the framework records the goodbye as "An internal
        // error occurred" (2026-07-21, the first clean finish_call through this
        // path — the caller heard the goodbye; only the tool result was marked
        // errored). The goodbye has fully played by now, so nothing is cut off.
        setTimeout(() => {
          this.session.close().catch(() => {
            /* already closing / torn down — the point was reached either way */
          });
        }, 0);
      },
    });

    super({
      instructions: buildChecklistPrompt({
        persona: opts.persona,
        runtime: opts.runtime,
        library,
        callerPhone: opts.callerPhone,
        knownCustomer: opts.knownCustomer,
        staffFirstNames: opts.staffFirstNames,
      }),
      tools: toolkit.selectedTools(),
    });
    this.#toolkit = toolkit;
    this.#tracker = tracker;
  }

  /** Exposed for tests and diagnostics. */
  currentTools(): llm.ToolContext {
    return this.#toolkit.selectedTools();
  }

  /** The checklist's first OPEN QUESTION right now, or null (no selection yet,
   *  or the frontier leads with an action). Feeds the checklist-aware turn
   *  detector: "were my questions answered?" needs to know which question the
   *  caller is currently answering. */
  pendingAskNodeId(): string | null {
    const first = this.#tracker.frontier()[0];
    return first && first.kind === 'ask' ? first.node_id : null;
  }

  // No onEnter greeting on purpose: index.ts speaks the tenant's PRE-GENERATED
  // greeting (zero TTS latency, the right voice); greeting here would double it.

  /**
   * THE STALL DETECTOR. A caller turn that moves the checklist NOWHERE — no new
   * answer, no selection change, no completed action — is a stalled turn,
   * whatever words filled it. After STALL_TURN_LIMIT of them in a row, a system
   * note lands in the model's context: stop re-asking, summarize, wrap up.
   *
   * Origin (SCL_nRKo3KEVw8Yh, 2026-07-27): an AI recruiter bot mirrored "would
   * you like me to leave a message?" back at the agent for FIVE MINUTES — both
   * sides politely deferring, the checklist frozen — extracting details the bot
   * had volunteered in its first sentence. Nothing in the loop was wrong enough
   * to break it: every individual turn looked like conversation. Only the
   * host's own state can see that the conversation has stopped going anywhere —
   * the same host-owns-truth principle as the goodbye gate.
   *
   * Mutation counts are compared ACROSS turns: the model's tool calls for turn
   * N run after this hook fires for turn N, so the snapshot taken here is what
   * turn N-1's reply achieved. The nudge fires once per stall (not every
   * stalled turn — repeating it would bury the context) and re-arms as soon as
   * the checklist moves again.
   */
  override async onUserTurnCompleted(
    chatCtx: llm.ChatContext,
    _newMessage: llm.ChatMessage
  ): Promise<void> {
    const mutations = this.#tracker.mutationCount();
    if (mutations !== this.#lastMutationCount) {
      this.#lastMutationCount = mutations;
      this.#stallTurns = 0;
      this.#stallNudged = false;
      return;
    }
    this.#stallTurns++;
    if (this.#stallTurns < STALL_TURN_LIMIT || this.#stallNudged) return;
    this.#stallNudged = true;
    chatCtx.addMessage({
      role: 'system',
      content:
        `The last ${this.#stallTurns} caller turns added NOTHING new to the checklist — ` +
        'the caller is repeating themselves, deflecting, or may be an automated system. ' +
        'Stop re-asking. In ONE sentence, summarize what you already have and move to ' +
        'close: if an action on the checklist is ready, do it now with what you have; if ' +
        'a required item is still missing, ask for that single item ONCE and accept a ' +
        'decline; then wrap up the call.',
    });
  }

  // Markdown must never reach the voice — same guarantee every agent path gives.
  override async ttsNode(
    text: ReadableStream<string>,
    modelSettings: Parameters<typeof voice.Agent.default.ttsNode>[2]
  ): ReturnType<typeof voice.Agent.default.ttsNode> {
    return voice.Agent.default.ttsNode(this, sanitizeStream(text), modelSettings);
  }
}
