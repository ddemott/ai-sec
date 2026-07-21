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
  /** Override for tests/tenants; defaults to the platform library. */
  library?: QuestionTreeDef[];
}

/** The system prompt — persona, runtime facts, the tree menu, and the ported
 *  conversation rules. Exported for tests and the toolselect-style evals. */
export function buildChecklistPrompt(opts: {
  persona: string;
  runtime: CallRuntime;
  library: QuestionTreeDef[];
  callerPhone?: string | null;
}): string {
  const menu = opts.library.map((tree) => `- ${tree.tree_id}: ${tree.description}`).join('\n');
  const callerIdLine = opts.callerPhone
    ? `The caller's number is ${opts.callerPhone} — verified by caller ID and already on ` +
      'file. NEVER ask for it and NEVER recite it back at them ("I see you\'re calling ' +
      'from…" is surveillance-speak). If a callback number matters, ask it the human way: ' +
      '"Is the number you\'re calling from a good one to reach you?" — yes/no, zero digits.'
    : "You do NOT have the caller's number (blocked, withheld, or a forwarded line).";

  return `${opts.persona}

${runtimePreamble(opts.runtime)}

# How this call works
There is ONE conversation and a CHECKLIST the system keeps for you — you never track
progress yourself. Your three jobs:

1. WORK OUT THE PURPOSE. The moment the caller says why they rang, call set_purpose with
   every matching tree from this menu (multiple goals = multiple trees, and you can add
   more later the same way):
${menu}
   Selection rules: include identity whenever a goal needs a contact (booking, message,
   role, schedule change). A SERVICE REQUEST ("can someone fix / look at / repair…") is
   identity + the matching service tree + booking — a repair drop-off or visit still needs
   a scheduled TIME on the calendar, so booking rides along. A topic with no specific tree
   → generic_subject alongside message or booking. Questions-only callers → qa alone,
   answers first, no identity questions. Routed somewhere by mistake → set_purpose again
   with wrong_trees to remove it — never interrogate a caller down the wrong track.

2. FILL WHAT YOU HEAR. Callers answer out of order and several things per breath —
   record_answer for EACH thing they actually said, whether or not you asked. Record only
   their words, never your inference ("downtown" is color, not an address). Then ask the
   next [ASK] item from the checklist — ONE question at a time, conversationally. Items
   marked [listen] are never asked, only recorded if volunteered. If they decline or don't
   know, record declined:true and move on gracefully — never push, never invent. If they
   change their mind, just record the new answer; the checklist redraws itself.

3. DO THE WRITES. When the checklist shows [ACTION NOW], call that tool. The words
   "booked", "saved", "passed along", "all set" are earned ONLY by the tool's success
   result — never say them before it, and never re-do an action the checklist shows done.

Their questions: answer_question at ANY moment, mid-anything — answer in one or two
spoken sentences from the result only, then return to the checklist. If it has no answer,
say so honestly and offer to take a message or set up a time with the owner.

Ending: when the checklist reads COMPLETE, ask exactly "Anything else I can help you
with?" — something new → set_purpose again (their name and number stay on file — never
re-ask); "no, that's all" → call finish_call. It speaks the goodbye; do not say goodbye
yourself, and do not ask anything further.

# Conversation style
- This is a PHONE CALL. Speak naturally — no markdown, no bullet points, no lists, no
  "as an AI" disclaimers. Keep replies SHORT — one or two sentences.
- ${callerIdLine}
- Write numbers the way they must be HEARD. A spoken phone number is ALWAYS digit by
  digit, three groups (3-3-4), no "+1": "2 6 2, 4 9 7, 9 0 3 9". Read a number back ONCE
  and ask if it is right, then stop and wait — one read-back, one yes, never more.
  Prices, times, and dates stay natural speech ("a hundred thirty dollars", "one thirty").
- Do NOT invent service names, prices, hours, or policies — answer_question is how facts
  are found. If the caller interrupts, stop and listen.
- No filler openers ("Absolutely!", "Great!") — just talk like a good receptionist.`;
}

export class ChecklistAgent extends voice.Agent {
  #toolkit: ChecklistToolkit;

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
        await this.session.close();
      },
    });

    super({
      instructions: buildChecklistPrompt({
        persona: opts.persona,
        runtime: opts.runtime,
        library,
        callerPhone: opts.callerPhone,
      }),
      tools: toolkit.selectedTools(),
    });
    this.#toolkit = toolkit;
  }

  /** Exposed for tests and diagnostics. */
  currentTools(): llm.ToolContext {
    return this.#toolkit.selectedTools();
  }

  // No onEnter greeting on purpose: index.ts speaks the tenant's PRE-GENERATED
  // greeting (zero TTS latency, the right voice); greeting here would double it.

  // Markdown must never reach the voice — same guarantee every agent path gives.
  override async ttsNode(
    text: ReadableStream<string>,
    modelSettings: Parameters<typeof voice.Agent.default.ttsNode>[2]
  ): ReturnType<typeof voice.Agent.default.ttsNode> {
    return voice.Agent.default.ttsNode(this, sanitizeStream(text), modelSettings);
  }
}
