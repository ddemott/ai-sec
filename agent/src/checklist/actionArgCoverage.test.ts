/**
 * NO ACTION TOOL MAY HAVE A REQUIRED ARG THE HOST CANNOT SUPPLY.
 *
 * WHO: every `action` node in the platform tree library, against the real tool
 *      schema it fires and against ACTION_ARG_BACKFILL.
 * WHAT: each REQUIRED parameter of an action tool must be either (a) backfilled
 *       from the tracker, or (b) listed below as a value only the model can
 *       produce — a time the caller chose, a free-text summary — with a reason.
 * WHEN: 2026-08-15, `sim-questiontree`. The model called
 *       `book_with_scheduling({"start_time": "Tuesday, July 22 at 1:15 PM"})` —
 *       a field the tool does not have — omitting all four required params. The
 *       caller had picked that time out loud. Because `service_type` and `phone`
 *       had no backfill, the write could not be completed from host state, the
 *       unconfirmed-booking guard refused it, the booking node stayed open, the
 *       goodbye gate held the door, and the call could not end. Twelve refusals
 *       and a spoken "the meeting is set" for a meeting that did not exist.
 *
 *       The same slip on `capture_job_inquiry` cost NOTHING the same afternoon —
 *       the model passed a made-up `role` arg and the row still landed correctly,
 *       because every field it needed was backfilled from the tracker.
 * WHY: that is the whole lesson. A required arg with no backfill is one model
 *      slip away from a dead call; a backfilled one is a typo nobody notices.
 *      The list below is the set of args we have accepted that risk for, and it
 *      should only ever get shorter.
 */
import { describe, expect, it } from 'vitest';
import { ACTION_ARG_BACKFILL } from './checklistTools.js';
import { PLATFORM_TREE_LIBRARY } from './trees.js';
import { buildTools } from '../tools.js';
import type { QuestionNodeDef } from './types.js';
import type { ToolsClient } from '../toolsClient.js';
import type { SessionContext } from '../sessionContext.js';

/**
 * Args the host supplies at RUNTIME rather than from a static tracker node —
 * `buildActionArgs` fills these itself. They are as covered as a backfill; they
 * just cannot be read off ACTION_ARG_BACKFILL.
 */
const HOST_DYNAMIC_ARGS: Record<string, Record<string, string>> = {
  cancel_appointment: {
    appointment_id: 'filled from get_my_appointments when it returned exactly one',
  },
  reschedule_appointment: {
    appointment_id: 'filled from get_my_appointments when it returned exactly one',
  },
};

/**
 * Args the MODEL must supply because no host state holds them. Each entry is a
 * deliberate, reviewed acceptance of the failure mode above — not a backlog.
 */
const MODEL_ONLY_ARGS: Record<string, Record<string, string>> = {
  reschedule_appointment: {
    // The new time the caller asked for. Conversational by nature — the same
    // shape as book_with_scheduling's window, and the same accepted risk.
    new_start_time: 'the time the caller asked to move to; spoken, never stored',
    new_end_time: 'derived from the new start and the service duration',
  },
  book_with_scheduling: {
    // The search window around the time the caller actually chose. The tracker
    // never holds it: the offer comes from get_available_slots and the choice is
    // spoken. This is the one the 2026-08-15 call died on, and it is why the
    // refusal now names it explicitly instead of saying "they have not picked".
    window_from: 'the caller-chosen instant; exists only in the conversation',
    window_to: 'the other end of that window; same reason',
  },
  take_message: {
    // Backfilled from `message_body` when the node is answered, but a message
    // can also be taken with the model summarizing on the spot.
    message: 'the message text itself; backfilled from message_body when present',
  },
};

/** Every `action` node in the library, flattened through choice branches. */
function collectActionTools(nodes: QuestionNodeDef[], out: Set<string>): void {
  for (const def of nodes) {
    if (def.type === 'action') {
      out.add(def.tool);
      continue;
    }
    if (def.type === 'choice') {
      for (const children of Object.values(def.options)) collectActionTools(children, out);
    }
  }
}

function requiredParamsOf(tool: unknown): string[] {
  const params = (tool as { parameters?: unknown } | undefined)?.parameters;
  if (!params || typeof params !== 'object') return [];
  const required = (params as { required?: unknown }).required;
  return Array.isArray(required) ? required.filter((r): r is string => typeof r === 'string') : [];
}

const stubClient = {
  call: () => Promise.resolve({ ok: true as const, result: {} }),
} as unknown as ToolsClient;
const stubCtx = { tenantId: 't', callId: 'c' } as unknown as SessionContext;

describe('action tools: every required arg is backfillable or declared model-only', () => {
  const actionTools = new Set<string>();
  for (const tree of PLATFORM_TREE_LIBRARY) collectActionTools(tree.nodes, actionTools);
  const tools = buildTools(stubCtx, stubClient);

  it('the library actually has action tools to check (guards a vacuous pass)', () => {
    expect(actionTools.size).toBeGreaterThan(3);
  });

  for (const toolName of [...actionTools].sort()) {
    it(`${toolName}: no required arg is left to chance`, () => {
      const real = (tools as Record<string, unknown>)[toolName];
      // A tree may name a tool that is gated off (SMS). Nothing to check.
      if (!real) return;

      const backfilled = new Set((ACTION_ARG_BACKFILL[toolName] ?? []).map((fill) => fill.arg));
      const declared = MODEL_ONLY_ARGS[toolName] ?? {};
      const dynamic = HOST_DYNAMIC_ARGS[toolName] ?? {};
      const uncovered = requiredParamsOf(real).filter(
        (arg) => !backfilled.has(arg) && !(arg in declared) && !(arg in dynamic)
      );

      expect(
        uncovered,
        `${toolName} requires ${uncovered.join(', ')}, and the host can neither supply ` +
          `it from the tracker nor has it been declared model-only. If the model omits ` +
          `it mid-call the write cannot complete from host state — which on 2026-08-15 ` +
          `deadlocked a call. Add a backfill in ACTION_ARG_BACKFILL, or add it to ` +
          `MODEL_ONLY_ARGS with the reason it cannot be backfilled.`
      ).toEqual([]);
    });
  }
});
