/**
 * T-008 — sampled vertical intake trees on the real host checklist path.
 *
 * WHO: catering / plumber / salon / real_estate front-desk presets.
 * WHAT: set_purpose selects the vertical intake tree; record_answer fires a
 *       real intake node id; tracker shows it answered; no "tree not found".
 * WHEN: CI whenever a vertical intake tree or preset wiring drifts.
 * WHERE: createChecklistTools + ChecklistTracker over PLATFORM_TREE_LIBRARY
 *        (the same library the live agent uses as template/fallback).
 * WHY: derivation tests prove the menu; this proves the host can actually
 *      select the intake tree and record into an intake node — the gap that
 *      left `job` unreachable despite being named in greetings.
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveSelectableTreeIds } from './checklistAgent.js';
import { createChecklistTools } from './checklistTools.js';
import { getPresetById } from './presets.js';
import { materializeRuntimeConfig } from './runtimeConfig.js';
import { ChecklistTracker } from './tracker.js';
import { PLATFORM_TREE_LIBRARY } from './trees.js';
import type { ToolMap } from '../tools.js';

type Exec = (args: unknown, ctx: unknown) => Promise<unknown>;
const call = async (tools: ToolMap, name: string, args: unknown = {}): Promise<string> =>
  (await (tools[name] as unknown as { execute: Exec }).execute(args, undefined)) as string;

const ok = (fields: Record<string, unknown>): string =>
  JSON.stringify({ success: true, ...fields });

function makeKit(presetId: string) {
  const preset = getPresetById(presetId);
  if (!preset) throw new Error(`preset not found: ${presetId}`);
  const fakes = {
    book_with_scheduling: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({ appointment_id: 'appt_1' })),
    },
    take_message: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({ message_id: 'msg_1' })),
    },
    capture_job_inquiry: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({ job_inquiry_id: 'ji_1' })),
    },
    identify_caller: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({ customer_id: 'cust_1' })),
    },
    get_company_policy_answer: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({ answer: 'Open 1 to 5.' })),
    },
    get_available_slots: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({ open_times: ['3:00 PM'] })),
    },
    get_service_catalog: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({ services: [] })),
    },
    get_my_appointments: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({ appointments: [] })),
    },
    cancel_appointment: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({ appointment_id: 'appt_9' })),
    },
    reschedule_appointment: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({ appointment_id: 'appt_9' })),
    },
    attach_meeting_notes: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({})),
    },
    get_customer_context: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({})),
    },
    send_verification_code: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({ sent: true })),
    },
    verify_phone_code: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({ verified: true })),
    },
  };
  const tracker = new ChecklistTracker(PLATFORM_TREE_LIBRARY);
  const toolkit = createChecklistTools({
    tracker,
    library: PLATFORM_TREE_LIBRARY,
    selectableTreeIds: resolveSelectableTreeIds({
      runtimeConfig: materializeRuntimeConfig(preset),
    }),
    realTools: fakes as unknown as ToolMap,
    onSelectionChanged: vi.fn(),
    closeCall: vi.fn(async () => {}),
  });
  return { toolkit, tracker, preset };
}

/** Primary ASK node per sampled vertical (not listen-only). */
const SAMPLES: Array<{
  slug: string;
  presetId: string;
  intakeTree: string;
  intakeNodeId: string;
  intakeValue: string;
}> = [
  {
    slug: 'catering',
    presetId: 'catering_front_desk',
    intakeTree: 'catering_intake',
    intakeNodeId: 'catering_event_type',
    intakeValue: 'corporate lunch for 40',
  },
  {
    slug: 'plumber',
    presetId: 'plumber_front_desk',
    intakeTree: 'plumber_intake',
    intakeNodeId: 'plumber_urgency',
    intakeValue: 'scheduled',
  },
  {
    slug: 'salon',
    presetId: 'salon_front_desk',
    intakeTree: 'salon_intake',
    intakeNodeId: 'salon_service_request',
    intakeValue: 'cut and blowout',
  },
  {
    slug: 'real_estate',
    presetId: 'real_estate_front_desk',
    intakeTree: 'real_estate_intake',
    intakeNodeId: 'real_estate_interest_type',
    intakeValue: 'buying',
  },
];

describe('T-008 vertical intake host path', () => {
  it.each(SAMPLES)(
    '$slug: selecting $intakeTree records $intakeNodeId (no tree-not-found)',
    async ({ presetId, intakeTree, intakeNodeId, intakeValue }) => {
      const { toolkit, tracker, preset } = makeKit(presetId);
      expect(preset.conversation_blocks).toContain(intakeTree);

      const refused = await call(toolkit.selectedTools(), 'set_purpose', {
        trees: ['not_a_real_tree'],
      });
      expect(refused.toLowerCase()).toMatch(/not enabled|no tree|unknown|not found/);

      const selected = await call(toolkit.selectedTools(), 'set_purpose', {
        work_direction: 'caller_wants_something_from_business',
        trees: ['identity', intakeTree],
      });
      expect(selected.toLowerCase()).not.toMatch(/no tree called|tree not found|not enabled/);
      expect(selected.toLowerCase()).not.toContain(`no tree called "${intakeTree}"`);

      const recorded = await call(toolkit.selectedTools(), 'record_answer', {
        node_id: intakeNodeId,
        value: intakeValue,
      });
      expect(recorded.toLowerCase()).not.toMatch(/unknown node|not found|no tree/);
      expect(tracker.status(intakeNodeId)).toBe('answered');
      expect(tracker.value(intakeNodeId)).toBe(intakeValue);
    }
  );
});
