/**
 * Step 7 call-path journeys — one real walk per shipped preset.
 *
 * WHO: the three front-desk presets compiling into the live checklist tools.
 * WHAT: set_purpose → record_answer → the write tool → finish_call, plus the
 *       forbidden-tree refusals that make auto-shop/salon/local-service differ.
 * WHEN: CI, whenever a preset's enabled or forbidden list changes.
 * WHERE: createChecklistTools + selectableTreeIds from materializeRuntimeConfig.
 * WHY: catalog/compile tests prove the menu; tool-exposure tests prove the
 *      keys exist. Neither proves a caller can complete a goal and hang up.
 */
import { describe, expect, it, vi } from 'vitest';
import type { llm } from '@livekit/agents';
import type { VerticalPresetDef } from './blockTypes.js';
import { resolveSelectableTreeIds } from './checklistAgent.js';
import { createChecklistTools } from './checklistTools.js';
import { AUTO_SHOP_PRESET, LOCAL_SERVICE_PRESET, SALON_PRESET } from './presets.js';
import { materializeRuntimeConfig } from './runtimeConfig.js';
import { ChecklistTracker } from './tracker.js';
import { PLATFORM_TREE_LIBRARY } from './trees.js';

type Exec = (args: unknown, ctx: unknown) => Promise<unknown>;
const call = async (tools: llm.ToolContext, name: string, args: unknown = {}): Promise<string> =>
  (await (tools[name] as unknown as { execute: Exec }).execute(args, undefined)) as string;

const ok = (fields: Record<string, unknown>): string =>
  JSON.stringify({ success: true, ...fields });

function makePresetKit(preset: VerticalPresetDef) {
  const fakes = {
    book_with_scheduling: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({ appointment_id: 'appt_1', booked_time: '3:00 PM' })),
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
      execute: vi.fn(async () => ok({ appointment_id: 'appt_1' })),
    },
    get_customer_context: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ok({ name: 'Camille' })),
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
  const closeCall = vi.fn(async () => {});
  const toolkit = createChecklistTools({
    tracker,
    library: PLATFORM_TREE_LIBRARY,
    selectableTreeIds: resolveSelectableTreeIds({
      runtimeConfig: materializeRuntimeConfig(preset),
    }),
    realTools: fakes as unknown as llm.ToolContext,
    onSelectionChanged: vi.fn(),
    closeCall,
  });
  return { toolkit, tracker, fakes, closeCall };
}

async function bookThrough(
  toolkit: ReturnType<typeof makePresetKit>['toolkit'],
  topic: string
): Promise<void> {
  await call(toolkit.selectedTools(), 'set_purpose', {
    work_direction: 'caller_wants_something_from_business',
    trees: ['identity', 'booking'],
  });
  for (const [node_id, value] of [
    ['caller_name', 'Sam'],
    ['caller_phone', '6308229086'],
    ['meeting_topic', topic],
  ] as const) {
    await call(toolkit.selectedTools(), 'record_answer', { node_id, value });
  }
}

describe('preset journeys', () => {
  it('auto shop: book an alignment, then hang up — job/buy_service never selectable', async () => {
    const { toolkit, fakes, closeCall } = makePresetKit(AUTO_SHOP_PRESET);

    expect(await call(toolkit.selectedTools(), 'set_purpose', { trees: ['job'] })).toContain(
      'No tree called "job"'
    );
    expect(
      await call(toolkit.selectedTools(), 'set_purpose', { trees: ['buy_service'] })
    ).toContain('No tree called "buy_service"');

    await bookThrough(toolkit, 'four-wheel alignment');
    const blocked = await call(toolkit.selectedTools(), 'finish_call', {});
    expect(blocked).toContain('not complete');
    expect(closeCall).not.toHaveBeenCalled();

    const booked = await call(toolkit.selectedTools(), 'book_with_scheduling', {});
    expect(booked).toContain('appt_1');
    expect(fakes.book_with_scheduling.execute).toHaveBeenCalledOnce();
    expect(Object.keys(toolkit.selectedTools())).not.toContain('capture_job_inquiry');

    expect(await call(toolkit.selectedTools(), 'finish_call', {})).toBe('Call complete.');
    expect(closeCall).toHaveBeenCalledOnce();
  });

  it('salon: leave a callback message, then hang up', async () => {
    const { toolkit, fakes, closeCall } = makePresetKit(SALON_PRESET);

    await call(toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'caller_wants_something_from_business',
      trees: ['identity', 'message'],
    });
    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'caller_name',
      value: 'Priya',
    });
    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'caller_phone',
      value: '6082175303',
    });
    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'message_body',
      value: 'move my Saturday color if you have a later chair',
    });

    expect(await call(toolkit.selectedTools(), 'finish_call', {})).toContain('not complete');
    expect(await call(toolkit.selectedTools(), 'take_message', {})).toContain('msg_1');
    expect(fakes.take_message.execute).toHaveBeenCalledOnce();
    expect(await call(toolkit.selectedTools(), 'finish_call', {})).toBe('Call complete.');
    expect(closeCall).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Priya'));
  });

  it('local service: qualify a buyer, book the demo, attach notes — job stays closed', async () => {
    const { toolkit, fakes, closeCall } = makePresetKit(LOCAL_SERVICE_PRESET);

    expect(await call(toolkit.selectedTools(), 'set_purpose', { trees: ['job'] })).toContain(
      'No tree called "job"'
    );

    await call(toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'caller_pays_us',
      trees: ['identity', 'buy_service', 'booking'],
    });
    for (const [node_id, value] of [
      ['caller_name', 'Chris'],
      ['caller_phone', '3125550100'],
      ['meeting_topic', 'see the AI receptionist for my shop'],
      ['business_type', 'independent garage'],
      ['call_volume', 'about twenty a day'],
      ['wants_handled', 'everything'],
      ['current_setup', 'voicemail'],
      ['best_email', 'chris@example.com'],
      ['demo_offer', 'wants_demo'],
    ] as const) {
      await call(toolkit.selectedTools(), 'record_answer', { node_id, value });
    }

    expect(await call(toolkit.selectedTools(), 'book_with_scheduling', {})).toContain('appt_1');
    expect(await call(toolkit.selectedTools(), 'attach_meeting_notes', {})).toContain('appt_1');
    expect(fakes.attach_meeting_notes.execute).toHaveBeenCalledOnce();
    expect(Object.keys(toolkit.selectedTools())).not.toContain('capture_job_inquiry');
    expect(await call(toolkit.selectedTools(), 'finish_call', {})).toBe('Call complete.');
    expect(closeCall).toHaveBeenCalledOnce();
  });
});
