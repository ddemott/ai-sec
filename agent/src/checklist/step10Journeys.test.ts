/**
 * Step 10 behavior journeys — the five required call paths plus policy /
 * unavailable / no-reask / no-double-write.
 *
 * WHO: live ChecklistAgent tool layer, same as a real call.
 * WHAT: recruiter+book, recruiter details-only, auto-shop book, salon book,
 *       missing-phone recovery, booking_mode=never, NO_AVAILABILITY, already
 *       answered, duplicate write.
 * WHEN: CI. These are the Step 10 E2E bar (behavior, not a Playwright voice).
 * WHERE: createChecklistTools + preset/runtimeConfig compile.
 * WHY: catalog tests prove the menu; these prove a stated goal can complete,
 *      recover, or refuse for the right reason.
 */
import { describe, expect, it, vi } from 'vitest';
import type { llm } from '@livekit/agents';
import type { TenantRuntimeConfig } from './blockTypes.js';
import { resolveSelectableTreeIds } from './checklistAgent.js';
import { createChecklistTools } from './checklistTools.js';
import { AUTO_SHOP_PRESET, SALON_PRESET } from './presets.js';
import { materializeRuntimeConfig } from './runtimeConfig.js';
import { ChecklistTracker } from './tracker.js';
import { PLATFORM_TREE_LIBRARY } from './trees.js';

type Exec = (args: unknown, ctx: unknown) => Promise<unknown>;
const call = async (tools: llm.ToolContext, name: string, args: unknown = {}): Promise<string> =>
  (await (tools[name] as unknown as { execute: Exec }).execute(args, undefined)) as string;

const ok = (fields: Record<string, unknown>): string =>
  JSON.stringify({ success: true, ...fields });

function makeKit(opts?: { runtimeConfig?: TenantRuntimeConfig; bookResults?: string[] }) {
  let bookCalls = 0;
  const bookResults = opts?.bookResults ?? [
    ok({ appointment_id: 'appt_1', booked_time: '3:00 PM' }),
  ];
  const fakes = {
    book_with_scheduling: {
      description: 'fake',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => {
        const row = bookResults[Math.min(bookCalls, bookResults.length - 1)];
        bookCalls += 1;
        return row;
      }),
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
      execute: vi.fn(async () => ok({ open_times: ['3:00 PM', 'Thursday 10 AM'] })),
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
  };
  const tracker = new ChecklistTracker(PLATFORM_TREE_LIBRARY);
  const closeCall = vi.fn(async () => {});
  const selectableTreeIds = opts?.runtimeConfig
    ? resolveSelectableTreeIds({ runtimeConfig: opts.runtimeConfig })
    : PLATFORM_TREE_LIBRARY.map((t) => t.tree_id);
  const toolkit = createChecklistTools({
    tracker,
    library: PLATFORM_TREE_LIBRARY,
    selectableTreeIds,
    realTools: fakes as unknown as llm.ToolContext,
    onSelectionChanged: vi.fn(),
    closeCall,
  });
  return { toolkit, tracker, fakes, closeCall };
}

async function fillJobIntake(
  toolkit: ReturnType<typeof makeKit>['toolkit'],
  offer: 'wants_meeting' | 'details_only'
): Promise<void> {
  await call(toolkit.selectedTools(), 'set_purpose', {
    work_direction: 'caller_offers_owner_work',
    trees: ['identity', 'job'],
  });
  for (const [node_id, value] of [
    ['caller_name', 'Priya'],
    ['caller_phone', '2624979039'],
    ['callers_company', 'Northgate'],
    ['hiring_for', 'own_company'],
    ['role_description', 'contract React role'],
    ['employment_type', 'full_time'],
    ['salary_range', '160k'],
    ['work_mode', 'remote'],
    ['team_timezone', 'Eastern'],
    ['meeting_offer', offer],
  ] as const) {
    await call(toolkit.selectedTools(), 'record_answer', { node_id, value });
  }
}

describe('Step 10 required journeys', () => {
  it('recruiter path: capture the role, book the meeting, hang up once', async () => {
    const { toolkit, fakes, closeCall, tracker } = makeKit();
    await fillJobIntake(toolkit, 'wants_meeting');
    expect(tracker.selectedTrees()).toContain('booking');
    expect(await call(toolkit.selectedTools(), 'capture_job_inquiry', {})).toContain('ji_1');
    expect(fakes.capture_job_inquiry.execute).toHaveBeenCalledOnce();
    expect(await call(toolkit.selectedTools(), 'book_with_scheduling', {})).toContain('appt_1');
    expect(fakes.book_with_scheduling.execute).toHaveBeenCalledOnce();
    expect(await call(toolkit.selectedTools(), 'finish_call', {})).toBe('Call complete.');
    expect(closeCall).toHaveBeenCalledOnce();
  });

  it('details-only path: capture the role, never book, hang up', async () => {
    const { toolkit, fakes, closeCall, tracker } = makeKit();
    await fillJobIntake(toolkit, 'details_only');
    expect(tracker.selectedTrees()).not.toContain('booking');
    expect(await call(toolkit.selectedTools(), 'capture_job_inquiry', {})).toContain('ji_1');
    expect(Object.keys(toolkit.selectedTools())).not.toContain('book_with_scheduling');
    expect(fakes.book_with_scheduling.execute).not.toHaveBeenCalled();
    expect(await call(toolkit.selectedTools(), 'finish_call', {})).toBe('Call complete.');
    expect(closeCall).toHaveBeenCalledOnce();
  });

  it('auto-shop path: alignment books through the preset; job stays forbidden', async () => {
    const { toolkit, fakes, closeCall } = makeKit({
      runtimeConfig: materializeRuntimeConfig(AUTO_SHOP_PRESET),
    });
    expect(await call(toolkit.selectedTools(), 'set_purpose', { trees: ['job'] })).toContain(
      'No tree called "job"'
    );
    await call(toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'caller_pays_us',
      trees: ['identity', 'booking'],
    });
    await call(toolkit.selectedTools(), 'record_answer', { node_id: 'caller_name', value: 'Sam' });
    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'caller_phone',
      value: '6308229086',
    });
    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'meeting_topic',
      value: 'four-wheel alignment on a F-150',
    });
    expect(await call(toolkit.selectedTools(), 'get_available_slots', {})).toContain('3:00 PM');
    expect(await call(toolkit.selectedTools(), 'book_with_scheduling', {})).toContain('appt_1');
    expect(fakes.book_with_scheduling.execute).toHaveBeenCalledOnce();
    expect(await call(toolkit.selectedTools(), 'finish_call', {})).toBe('Call complete.');
    expect(closeCall).toHaveBeenCalledOnce();
  });

  it('salon path: color with a named stylist books; buy_service stays forbidden', async () => {
    const { toolkit, fakes, closeCall } = makeKit({
      runtimeConfig: materializeRuntimeConfig(SALON_PRESET),
    });
    expect(
      await call(toolkit.selectedTools(), 'set_purpose', { trees: ['buy_service'] })
    ).toContain('No tree called "buy_service"');
    await call(toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'caller_pays_us',
      trees: ['identity', 'booking'],
    });
    await call(toolkit.selectedTools(), 'record_answer', { node_id: 'caller_name', value: 'Maya' });
    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'caller_phone',
      value: '6082175303',
    });
    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'meeting_topic',
      value: 'Saturday color with Jenna if she is free',
    });
    expect(await call(toolkit.selectedTools(), 'book_with_scheduling', {})).toContain('appt_1');
    expect(fakes.book_with_scheduling.execute).toHaveBeenCalledOnce();
    expect(await call(toolkit.selectedTools(), 'finish_call', {})).toBe('Call complete.');
    expect(closeCall).toHaveBeenCalledOnce();
  });

  it('missing-phone recovery: book stays blocked until a number is recorded', async () => {
    const { toolkit, tracker, closeCall } = makeKit();
    await call(toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'caller_pays_us',
      trees: ['identity', 'booking'],
    });
    await call(toolkit.selectedTools(), 'record_answer', { node_id: 'caller_name', value: 'Sam' });
    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'meeting_topic',
      value: 'oil change',
    });
    const blocked = await call(toolkit.selectedTools(), 'book_with_scheduling', {});
    expect(blocked).toContain('first resolve:');
    expect(blocked).toContain('caller_phone');
    expect(tracker.status('book')).toBe('blocked');
    expect(await call(toolkit.selectedTools(), 'finish_call', {})).toContain('not complete');
    expect(closeCall).not.toHaveBeenCalled();

    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'caller_phone',
      value: '6308229086',
    });
    expect(await call(toolkit.selectedTools(), 'book_with_scheduling', {})).toContain('appt_1');
    expect(await call(toolkit.selectedTools(), 'finish_call', {})).toBe('Call complete.');
    expect(closeCall).toHaveBeenCalledOnce();
  });
});

describe('Step 10 must-have behaviors', () => {
  it('already-answered: the checklist stops marking the field [ASK]', async () => {
    const { toolkit, tracker } = makeKit();
    await call(toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'neither_or_unclear',
      trees: ['identity'],
    });
    const first = await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'caller_name',
      value: 'Sam',
    });
    expect(tracker.status('caller_name')).toBe('answered');
    expect(tracker.renderState()).toContain('[✓] caller_name: Sam');
    expect(tracker.renderState()).not.toMatch(/\[ASK\] caller_name/);
    expect(first).toMatch(/already resolved|Do NOT ask caller_name/i);
  });

  it('duplicate retry does not fire the write twice', async () => {
    const { toolkit, fakes } = makeKit();
    await call(toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'neither_or_unclear',
      trees: ['identity', 'message'],
    });
    await call(toolkit.selectedTools(), 'record_answer', { node_id: 'caller_name', value: 'Sam' });
    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'caller_phone',
      value: '6308229086',
    });
    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'message_body',
      value: 'call me back',
    });
    expect(await call(toolkit.selectedTools(), 'take_message', {})).toContain('msg_1');
    const repeat = await call(toolkit.selectedTools(), 'take_message', {});
    expect(repeat).toContain('ALREADY DONE');
    expect(fakes.take_message.execute).toHaveBeenCalledOnce();
  });

  it('service unavailable offers the next open time instead of completing the book', async () => {
    const { toolkit, tracker, fakes } = makeKit({
      bookResults: [
        JSON.stringify({
          success: false,
          error: 'NO_AVAILABILITY',
          next_available: 'Thursday 10 AM',
        }),
        ok({ appointment_id: 'appt_2', booked_time: 'Thursday 10 AM' }),
      ],
    });
    await call(toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'caller_pays_us',
      trees: ['identity', 'booking'],
    });
    await call(toolkit.selectedTools(), 'record_answer', { node_id: 'caller_name', value: 'Sam' });
    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'caller_phone',
      value: '6308229086',
    });
    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'meeting_topic',
      value: 'alignment',
    });
    const miss = await call(toolkit.selectedTools(), 'book_with_scheduling', {});
    expect(miss).toContain('NO_AVAILABILITY');
    expect(miss).toContain('Thursday 10 AM');
    expect(tracker.status('book')).toBe('ready');
    expect(await call(toolkit.selectedTools(), 'book_with_scheduling', {})).toContain('appt_2');
    expect(fakes.book_with_scheduling.execute).toHaveBeenCalledTimes(2);
    expect(tracker.status('book')).toBe('done');
  });

  it('booking_mode=never drops the booking tree on an auto-shop preset', async () => {
    const runtime: TenantRuntimeConfig = {
      preset_id: AUTO_SHOP_PRESET.preset_id,
      enabled_conversation_blocks: AUTO_SHOP_PRESET.conversation_blocks.filter(
        (id) => id !== 'booking'
      ),
      enabled_policy_blocks: [],
      enabled_knowledge_blocks: [],
      enabled_outcome_blocks: [],
      overrides: { booking_mode: 'never' },
      version: 1,
    };
    const { toolkit } = makeKit({ runtimeConfig: runtime });
    expect(await call(toolkit.selectedTools(), 'set_purpose', { trees: ['booking'] })).toContain(
      'No tree called "booking"'
    );
    await call(toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'neither_or_unclear',
      trees: ['identity', 'message'],
    });
    await call(toolkit.selectedTools(), 'record_answer', { node_id: 'caller_name', value: 'Sam' });
    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'caller_phone',
      value: '6308229086',
    });
    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'message_body',
      value: 'please call back',
    });
    expect(await call(toolkit.selectedTools(), 'take_message', {})).toContain('msg_1');
    expect(Object.keys(toolkit.selectedTools())).not.toContain('book_with_scheduling');
  });
});
