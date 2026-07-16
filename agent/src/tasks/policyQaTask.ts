/**
 * RUNG — QUESTIONS ABOUT THE BUSINESS, answered from the KNOWLEDGE BASE.
 *
 * "What are your hours?" "How much is a consultation?" "Where are you located?"
 * A caller whose need is INFORMATION is as real as one who wants a booking — and on
 * the ladder this was the flow most likely to produce a confident hallucination,
 * because hours and prices are exactly the facts a model will invent fluently.
 *
 * The retrieval layer already exists and is measured (get_company_policy_answer →
 * /agent-tools/policy-answer → search_tenant_docs pgvector; the sim-rag eval holds it
 * at 100% incl. out-of-scope fallbacks). This rung adds what retrieval alone cannot:
 * the guarantee that a questions-call ENDS properly. It is a COLLECT rung — there is
 * no backend write that means "curiosity satisfied" — so a synthetic
 * `questions_answered` tool is the exit, and the TaskGroup loop does not end until it
 * (or the message fallback below) fires.
 *
 * TWO ENDINGS, deliberately (the scheduling rung's multi-completion pattern):
 *   - questions_answered — the caller got what they came for.
 *   - take_message (ACTION) — the knowledge base could not answer and the caller
 *     wants the owner to get back to them. The route's own fallback text offers
 *     exactly that pivot; a rung that offered it while holding no tool to do it
 *     would promise a save it cannot perform — the 2026-07-16 class of bug.
 *
 * IDENTITY IS NOT REQUIRED HERE. A caller asking when you're open must not be
 * interrogated for a name and number first (see planCallTasks: a questions-only call
 * skips the identity rung entirely). If the message fallback is taken, the rung
 * gathers name + number itself and passes them explicitly — take_message's backend
 * gate refuses a message the owner cannot answer, same belt-and-braces as job intake.
 */
import { type llm, type voice } from '@livekit/agents';
import { makeRung, idExtractor, type RungCompletion } from './rung.js';

export interface PolicyQaResult {
  outcome: 'answered' | 'message';
  /** Present when outcome is 'message'. */
  messageId?: string;
  raw?: unknown;
}

export interface PolicyQaTaskOptions {
  /** The knowledge tools from buildTools() — must include get_company_policy_answer. */
  knowledgeTools: llm.ToolContext;
  /** The take_message tool — the fallback ending for questions the KB cannot answer.
   *  Omit → the rung's only exit is questions_answered. */
  takeMessage?: llm.ToolContext[string];
  /** Injected when identity DID run first (mixed-goal calls) so the rung never re-asks. */
  knownCaller?: string;
  /** TRUE when a booking rung is queued right after this one. The rung is an ISLAND
   *  (root cause 1) — without this it truthfully says "I can't book" about a call
   *  where the very next step books, and the caller gives up. The live-LLM sim
   *  caught exactly that: "Can I go ahead and book?" → "I don't have the ability
   *  to book sessions directly" → caller disengaged → 0/4. */
  bookingFollows?: boolean;
  /** Date + hours, threaded like every rung (gotcha #1) — "when are you open" often
   *  needs today's date to answer "are you open right now". */
  runtimePreamble?: string;
  onAnswered?: (r: PolicyQaResult) => Promise<void> | void;
}

export const POLICY_QA_INTRO = `The caller has questions about the business. If their first question is already on the table, your FIRST action on this rung is the get_company_policy_answer call — before your first word to them. Only when no question has been asked yet do you open by inviting one: "Of course — what would you like to know?"`;

export const POLICY_QA_INSTRUCTIONS = `Your one job is to answer the caller's questions about the business — hours, pricing, services, policies, location, anything factual.

EVERY factual answer comes from the knowledge base. Before you answer ANY question about the business, your VERY NEXT action is to CALL get_company_policy_answer with the caller's question — never answer from memory, never guess, never invent an hour or a price. The knowledge base returns IN AN INSTANT: call it silently, and your very next words are its answer — the result is back before a "one moment" or a "let me check" would even finish, so never say either. A price or an hour you did not just read out of a tool result is a price you are making up. Read back what the tool returns, naturally and in one or two spoken sentences. If it cites a source, you may attribute it conversationally ("according to our cancellation policy…") — never read bracket markers aloud.

Answer ONE question at a time, then wait for the next. Do not volunteer information they did not ask about.

When the caller indicates they have what they need ("that's all", "no more questions", "thanks, that's it"), your VERY NEXT action is to CALL questions_answered — call it BEFORE any goodbye. The wrap-up is spoken for you after it runs.

This is a PHONE CALL: short spoken sentences, no lists, no markdown.`;

/** KB-miss guidance WHEN the rung holds take_message. */
export const QA_KB_MISS_WITH_MESSAGE = `If the tool says it does not have the information, tell the caller honestly and offer to take a message so the owner can get back to them with the answer:
  → IF they want that: ask for their name and the best number to reach them, then CALL take_message with caller_name, callback_phone, and their question as the message. Calling the tool is the ONLY thing that records it — never say a message is saved before the tool has run.
  → IF they decline: carry on with their next question, or finish.`;

/** KB-miss guidance when the rung does NOT hold take_message — it must never be told
 *  to call a tool it does not have (that is an impossible instruction, and impossible
 *  instructions are how callers get stranded). */
export const QA_KB_MISS_NO_MESSAGE = `If the tool says it does not have the information, tell the caller honestly that you don't have that detail, and carry on with their next question — never invent an answer to fill the gap, and never promise that someone will follow up.`;

/** Appended when a booking rung is queued right after this one (mixed-goal calls). */
export const QA_BOOKING_FOLLOWS = `A BOOKING STEP COMES RIGHT AFTER THIS ONE — the system books meetings the moment your part is done, so NEVER say you cannot book, cannot schedule, or that they should "contact the business". If the caller says they want to book, that IS their questions being answered: your VERY NEXT action is to CALL questions_answered, and the booking step takes over in the same breath. Say nothing about booking yourself — no goodbye, no "someone will help you" — just call the tool.`;

/** Appended on questions-ONLY calls (no booking rung follows) WHEN take_message is held. */
export const QA_NO_BOOKING_FOLLOWS = `If the caller decides they want an appointment, a callback, or anything beyond answers: do not claim you cannot help — ask for their name and best number, then CALL take_message with what they want, so the owner can get back to them to arrange it. The tool call is the only thing that records it.`;

/** Questions-only AND no take_message: the only honest move is honesty. */
export const QA_NO_BOOKING_NO_MESSAGE = `If the caller decides they want an appointment or a callback, tell them plainly that arranging it is beyond this call, and suggest they call back — promise nothing you have no tool to perform.`;

/**
 * Built on makeRung as a COLLECT rung with an ACTION fallback. The completion tools:
 * questions_answered (synthetic — curiosity has no success id) and, when provided,
 * the real take_message (completes on message_id, the write IS the transition).
 */
export function makePolicyQaRung(opts: PolicyQaTaskOptions): voice.AgentTask<PolicyQaResult> {
  const { knowledgeTools, takeMessage, onAnswered } = opts;

  const realPolicyAnswer = knowledgeTools['get_company_policy_answer'];
  if (!realPolicyAnswer) {
    throw new Error('makePolicyQaRung requires get_company_policy_answer in knowledgeTools');
  }

  const completions: RungCompletion<PolicyQaResult>[] = [
    {
      kind: 'collect',
      toolName: 'questions_answered',
      description:
        'Call this ONCE the caller says they have no more questions. It finishes the question-answering step. Do not call it while a question is still unanswered.',
      parameters: { type: 'object', properties: {} },
      build: (): PolicyQaResult => ({ outcome: 'answered' }),
      onDone: onAnswered,
    },
  ];

  if (takeMessage) {
    completions.push({
      kind: 'action',
      toolName: 'take_message',
      realTool: takeMessage,
      extract: idExtractor('message_id', (id, raw) => ({
        outcome: 'message' as const,
        messageId: id,
        raw,
      })),
      onDone: onAnswered,
    });
  }

  return makeRung<PolicyQaResult>({
    instructions: [
      opts.runtimePreamble,
      opts.knownCaller,
      POLICY_QA_INTRO,
      POLICY_QA_INSTRUCTIONS,
      // Every line below names only tools this rung actually holds — an instruction
      // that names an absent tool is impossible to follow, and impossible
      // instructions strand callers (Copilot review catch, 2026-07-16).
      takeMessage ? QA_KB_MISS_WITH_MESSAGE : QA_KB_MISS_NO_MESSAGE,
      opts.bookingFollows
        ? QA_BOOKING_FOLLOWS
        : takeMessage
          ? QA_NO_BOOKING_FOLLOWS
          : QA_NO_BOOKING_NO_MESSAGE,
    ]
      .filter(Boolean)
      .join('\n\n'),
    // ONLY the retrieval tool rides along (rule 8) — and it is load-bearing here:
    // it is the entire point of the rung, not a lookup the rung could survive
    // skipping. The instructions still route around a failed retrieval (honest
    // "I don't have that" + the message fallback), so an errored tool cannot
    // strand the caller.
    tools: { get_company_policy_answer: realPolicyAnswer },
    completion: completions,
  });
}
