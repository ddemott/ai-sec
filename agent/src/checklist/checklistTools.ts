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
import {
  type ChecklistTracker,
  RecordError,
  UnknownNodeError,
  UnknownTreeError,
} from './tracker.js';
import type { ActionNodeDef, QuestionTreeDef } from './types.js';
import { CALLER_NAME, CALLER_PHONE } from './trees.js';

/** The JSON field whose presence in a tool's result proves the write LANDED. */
const ACTION_ID_FIELDS: Record<string, string> = {
  book_with_scheduling: 'appointment_id',
  take_message: 'message_id',
  capture_job_inquiry: 'job_inquiry_id',
  cancel_appointment: 'appointment_id',
  reschedule_appointment: 'appointment_id',
};

/** Read tools a tree needs alongside its action (the calendar for a booking). */
const TREE_PASSTHROUGH_TOOLS: Record<string, string[]> = {
  booking: ['get_available_slots', 'get_service_catalog'],
  schedule_change: ['get_my_appointments', 'get_available_slots'],
};

/** How many times set_purpose may fire before the call is told to wrap up. */
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
  let identifySent = false;
  const failCounts = new Map<string, number>();

  const stateBlock = (): string => `CHECKLIST STATE:\n${tracker.renderState()}`;

  /** Host-code phone-book save the moment both identity facts are in — never
   *  the model's job, never skipped when the caller only leaves a message. */
  const maybeIdentify = (): void => {
    const name = tracker.value(CALLER_NAME);
    const phone = tracker.value(CALLER_PHONE);
    const identify = realTools['identify_caller'];
    if (identifySent || !name || !phone || !identify) return;
    identifySent = true;
    void shape(identify)
      .execute({ name, phone }, undefined)
      .catch((err: unknown) => {
        getLogger().warn(
          { event: 'checklist_identify_failed', err: String(err) },
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
      required: ['trees'],
    },
    execute: (args: {
      trees: string[];
      wrong_trees?: string[];
      caller_name?: string;
      caller_phone?: string;
    }): Promise<string> => Promise.resolve(runSetPurpose(args)),
  });

  function runSetPurpose(args: {
    trees: string[];
    wrong_trees?: string[];
    caller_name?: string;
    caller_phone?: string;
  }): string {
    {
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
      return `Purpose set: ${tracker.selectedTrees().join(' + ')}.${callerIdNote}\n${stateBlock()}`;
    }
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

  function runRecordAnswer(args: { node_id: string; value?: string; declined?: boolean }): string {
    try {
      tracker.record(args.node_id, { value: args.value, declined: args.declined });
    } catch (err) {
      // The error text IS the corrective instruction — hand it straight back.
      if (err instanceof RecordError || err instanceof UnknownNodeError) return err.message;
      throw err;
    }
    maybeIdentify();
    return stateBlock();
  }

  const finish_call = llm.tool({
    description:
      "Call when the caller has nothing further ('no thanks', 'that's all'). Speaks the " +
      'goodbye and ends the call. Refuses while the checklist still has open items.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (): Promise<string> => {
      // The gate: a selected-but-unresolved checklist holds the door shut. A
      // call with NO selection may close (wrong number, instant hang-up ask).
      if (tracker.hasSelection() && !tracker.isResolved()) {
        return `Not yet — the checklist is not complete. Finish these first. ${stateBlock()}`;
      }
      const name = tracker.value(CALLER_NAME);
      const goodbye = name
        ? `You're all set, ${name}. Thanks for calling, and have a great day!`
        : `You're all set. Thanks for calling, and have a great day!`;
      await deps.closeCall(goodbye);
      return 'Call complete.';
    },
  });

  const baseTools: llm.ToolContext = { set_purpose, record_answer, finish_call };

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
        const raw = await shape(real).execute(args, toolCtx);
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
