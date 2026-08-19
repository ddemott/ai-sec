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
import type { TenantRuntimeConfig } from './blockTypes.js';
import { resolveSelectableTreeIds } from './checklistAgent.js';
import { createChecklistTools } from './checklistTools.js';
import { AUTO_SHOP_PRESET, SALON_PRESET } from './presets.js';
import { materializeRuntimeConfig } from './runtimeConfig.js';
import { ChecklistTracker } from './tracker.js';
import { PLATFORM_TREE_LIBRARY } from './trees.js';
import type { ToolMap } from '../tools.js';

type Exec = (args: unknown, ctx: unknown) => Promise<unknown>;
const call = async (tools: ToolMap, name: string, args: unknown = {}): Promise<string> =>
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
    realTools: fakes as unknown as ToolMap,
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
      'The "job" intake is not enabled'
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
    // Times are on the table now, so the write must name the one the caller
    // picked — booking with bare args here is what nearly booked a caller
    // mid-question on 2026-08-13 (see the unconfirmed-booking guard below).
    expect(
      await call(toolkit.selectedTools(), 'book_with_scheduling', {
        requested_start: '2026-08-17T15:00:00',
      })
    ).toContain('appt_1');
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
    ).toContain('The "buy_service" intake is not enabled');
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
      'The "booking" intake is not enabled'
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

describe('hire-intake selector journeys (2026-08-13 position/contract/meeting)', () => {
  it('last-call miss: position-as-message nudges ADD job, still can take_message and hang up', async () => {
    // WHO: Jack Smith, browser call, "a position I had for him that's in Chicago"
    // WHAT: model picked identity+message + caller_offers_owner_work
    // WHY: host must NUDGE job (not refuse) — a callback-only recruiter is legal —
    //      and the message write must still complete so the owner is not empty-handed.
    const { toolkit, fakes, closeCall, tracker } = makeKit();
    const purpose = await call(toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'caller_offers_owner_work',
      trees: ['identity', 'message'],
      caller_name: 'Jack Smith',
    });
    expect(purpose).toMatch(/job tree is not selected/i);
    expect(purpose).toMatch(/ADD job/);
    expect(tracker.selectedTrees()).not.toContain('job');
    expect(tracker.selectedTrees()).not.toContain('booking');
    expect(Object.keys(toolkit.selectedTools())).not.toContain('capture_job_inquiry');

    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'caller_phone',
      value: '6301112222',
    });
    await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'message_body',
      value: 'I have a position for him that is in Chicago.',
    });
    expect(await call(toolkit.selectedTools(), 'take_message', {})).toContain('msg_1');
    expect(fakes.take_message.execute).toHaveBeenCalledOnce();
    expect(fakes.capture_job_inquiry.execute).not.toHaveBeenCalled();
    expect(await call(toolkit.selectedTools(), 'finish_call', {})).toBe('Call complete.');
    expect(closeCall).toHaveBeenCalledOnce();
  });

  it('talk-to about a position: identity+job+booking captures, books, hangs up once', async () => {
    // WHO: same opener if the selector obeyed "talk to … about a position"
    // WHAT: two goals — hire intake AND a meeting
    const { toolkit, fakes, closeCall, tracker } = makeKit();
    const purpose = await call(toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'caller_offers_owner_work',
      trees: ['identity', 'job', 'booking'],
      caller_name: 'Jack Smith',
    });
    expect(purpose).not.toMatch(/job tree is not selected/i);
    expect(tracker.selectedTrees()).toEqual(expect.arrayContaining(['identity', 'job', 'booking']));

    for (const [node_id, value] of [
      ['caller_phone', '6301112222'],
      ['callers_company', 'Northgate'],
      ['hiring_for', 'own_company'],
      ['role_description', 'a position I had for him that is in Chicago'],
      ['employment_type', 'contract'],
      ['rate_range', '80 an hour'],
      ['contract_length', '6 months'],
      ['work_mode', 'remote'],
      ['team_timezone', 'Central'],
      ['meeting_offer', 'wants_meeting'],
      ['meeting_topic', 'a position in Chicago'],
    ] as const) {
      await call(toolkit.selectedTools(), 'record_answer', { node_id, value });
    }
    expect(await call(toolkit.selectedTools(), 'capture_job_inquiry', {})).toContain('ji_1');
    expect(await call(toolkit.selectedTools(), 'book_with_scheduling', {})).toContain('appt_1');
    expect(fakes.capture_job_inquiry.execute).toHaveBeenCalledOnce();
    expect(fakes.book_with_scheduling.execute).toHaveBeenCalledOnce();
    expect(await call(toolkit.selectedTools(), 'finish_call', {})).toBe('Call complete.');
    expect(closeCall).toHaveBeenCalledOnce();
  });

  it('contract opener without booking: meeting_offer yes host-adds booking', async () => {
    // WHO: "I have a contract for him" then yes to the meeting offer
    // WHAT: start job-only; wants_meeting must select booking in HOST code
    const { toolkit, tracker } = makeKit();
    await call(toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'caller_offers_owner_work',
      trees: ['identity', 'job'],
    });
    expect(tracker.selectedTrees()).not.toContain('booking');
    for (const [node_id, value] of [
      ['caller_name', 'Rita'],
      ['caller_phone', '5551112233'],
      ['callers_company', 'Apex'],
      ['hiring_for', 'own_company'],
      ['role_description', 'contract React role'],
      ['employment_type', 'contract'],
      ['rate_range', '90'],
      ['contract_length', '3 months'],
      ['work_mode', 'remote'],
      ['team_timezone', 'Eastern'],
    ] as const) {
      await call(toolkit.selectedTools(), 'record_answer', { node_id, value });
    }
    const offer = await call(toolkit.selectedTools(), 'record_answer', {
      node_id: 'meeting_offer',
      value: 'wants_meeting',
    });
    expect(offer).toMatch(/booking is now ON YOUR CHECKLIST/i);
    expect(tracker.selectedTrees()).toContain('booking');
    expect(Object.keys(toolkit.selectedTools())).toContain('book_with_scheduling');
  });

  it('SAD: auto-shop preset cannot start hire intake even with owner-gets-paid direction', async () => {
    const { toolkit } = makeKit({
      runtimeConfig: materializeRuntimeConfig(AUTO_SHOP_PRESET),
    });
    expect(
      await call(toolkit.selectedTools(), 'set_purpose', {
        work_direction: 'caller_offers_owner_work',
        trees: ['job'],
      })
    ).toContain('The "job" intake is not enabled');
  });

  it('SAD: finish_call stays shut while a talk-to meeting is selected but unbooked', async () => {
    const { toolkit, closeCall } = makeKit();
    await call(toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'caller_offers_owner_work',
      trees: ['identity', 'job', 'booking'],
    });
    for (const [node_id, value] of [
      ['caller_name', 'Jack'],
      ['caller_phone', '6301112222'],
      ['callers_company', 'Northgate'],
      ['hiring_for', 'own_company'],
      ['role_description', 'position in Chicago'],
      ['employment_type', 'full_time'],
      ['salary_range', '160k'],
      ['work_mode', 'remote'],
      ['team_timezone', 'Central'],
      ['meeting_offer', 'wants_meeting'],
      ['meeting_topic', 'a position in Chicago'],
    ] as const) {
      await call(toolkit.selectedTools(), 'record_answer', { node_id, value });
    }
    await call(toolkit.selectedTools(), 'capture_job_inquiry', {});
    const hung = await call(toolkit.selectedTools(), 'finish_call', {});
    expect(hung).toMatch(/not complete/i);
    expect(closeCall).not.toHaveBeenCalled();

    // From the SECOND refusal on it must stop being a bare "not yet" and say
    // the thing the model kept getting wrong on the 2026-08-15 sim: nothing has
    // landed, so nothing may be claimed. It answered the bare refusal there
    // with "I'm still finalizing your meeting" — a meeting that did not exist.
    const again = await call(toolkit.selectedTools(), 'finish_call', {});
    expect(again).toContain('Nothing on this checklist has landed');
    expect(again).toContain('take a message');
    expect(closeCall).not.toHaveBeenCalled();

    // WHO: a caller who has already said goodbye. WHAT: after FINISH_REFUSAL_LIMIT
    // refusals the gate releases the call. WHEN: 2026-08-15 sim — the gate
    // refused, the booking guard refused, and the two of them held a caller who
    // had said goodbye twice on a call that could only end by hanging up.
    // WHY: the gate protects a stated goal; once it has demonstrably failed to
    // produce completion, holding the line protects nothing and costs the
    // hang-up. The release is logged at WARN with the unmet nodes.
    for (let i = 0; i < 2; i++) await call(toolkit.selectedTools(), 'finish_call', {});
    expect(closeCall).not.toHaveBeenCalled();
    expect(await call(toolkit.selectedTools(), 'finish_call', {})).toBe('Call complete.');
    expect(closeCall).toHaveBeenCalledOnce();
  });
});

/**
 * THE UNCONFIRMED-BOOKING GUARD (2026-08-13, call SCL_KLvqZ2JkaQFU).
 *
 * WHO: Camille, asking "What's his availability next week?"
 * WHAT: the agent read out Monday 1:00 / 1:15 / 1:30 and asked which worked —
 *       then called book_with_scheduling 1.9 SECONDS later, 30 seconds before
 *       she said another word, with a five-day window and no requested_start.
 * WHEN: t=41.6s (slots) → t=43.5s (book attempt) → t=1:13 (caller's next word).
 * WHERE: wrapAction, ahead of the real tool.
 * WHY: book_with_scheduling takes the EARLIEST slot at or after window_from, so
 *      it was one parse away from booking her into 1:00 PM while she was still
 *      listening to the question. It missed only because the model wrote
 *      `2026-08-17T01:00:00` — 1 AM — for the 1 PM slot it had just offered.
 *      A write the caller never agreed to must not depend on a typo.
 */
describe('unconfirmed-booking guard', () => {
  const setUpOffer = async (): Promise<ReturnType<typeof makeKit>> => {
    const kit = makeKit();
    await call(kit.toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'caller_pays_us',
      trees: ['identity', 'booking'],
    });
    for (const [node_id, value] of [
      ['caller_name', 'Camille'],
      ['caller_phone', '2624979039'],
      ['meeting_topic', 'a position'],
    ] as const) {
      await call(kit.toolkit.selectedTools(), 'record_answer', { node_id, value });
    }
    await call(kit.toolkit.selectedTools(), 'get_available_slots', {});
    return kit;
  };

  it('refuses to book while offered times are unanswered', async () => {
    const { toolkit, fakes } = await setUpOffer();
    const refused = await call(toolkit.selectedTools(), 'book_with_scheduling', {
      window_from: '2026-08-17T01:00:00',
      window_to: '2026-08-21T17:00:00',
    });
    expect(refused).toContain('NOTHING in your arguments names which one');
    expect(refused).toContain('requested_start');
    // It must name what is actually missing. The old refusal said only "the
    // caller has not picked one", which on the 2026-08-15 sim was FALSE — the
    // caller HAD picked 1:15 and the model had put it in `start_time`, a field
    // this tool does not have. The model re-sent that same malformed call
    // twelve times, because the refusal pointed it at the wrong problem.
    expect(refused).toContain('"start_time" is not a parameter of this tool');
    expect(refused).toContain('NOTHING IS BOOKED');
    // The real tool must never have been reached — the caller is not booked.
    expect(fakes.book_with_scheduling.execute).not.toHaveBeenCalled();
  });

  it('names the required arguments the model actually omitted', async () => {
    const { toolkit } = await setUpOffer();
    // No window at all. `service_type` and `phone` are NOT named here: both are
    // backfilled from the tracker, so listing them would send the model chasing
    // values the host already supplies. Only what it must provide is named.
    const refused = await call(toolkit.selectedTools(), 'book_with_scheduling', {});
    expect(refused).toContain('You also omitted required argument(s): window_from, window_to');
    expect(refused).not.toContain('service_type,');
  });

  /**
   * WHO: any caller who picks a time the model then cannot name in the tool's
   * own parameters. WHAT: the guard stands down after two refusals instead of
   * refusing forever. WHEN: 2026-08-15, `sim-questiontree` DALE'S CALL — the
   * caller said "I'll take the 1:15 slot", the model sent
   * `{"start_time":"Tuesday, July 22 at 1:15 PM"}`, and the guard refused it
   * twelve times. WHERE: the unconfirmed-booking guard in checklistTools.
   * WHY: `slotsAwaitingChoice` cleared ONLY on a successful booking, and a
   * refusal returns before `failCounts`, so neither escape hatch could fire —
   * the booking node stayed unresolved, the goodbye gate held the door shut,
   * and the call could not end. Stopping the FIRST blind write is the guard's
   * whole value; refusing the twelfth buys nothing and costs the call.
   */
  it('stands down after repeated refusals rather than deadlocking the call', async () => {
    const { toolkit, fakes } = await setUpOffer();
    const blind = { window_from: '2026-08-17T01:00:00', window_to: '2026-08-21T17:00:00' };

    const first = await call(toolkit.selectedTools(), 'book_with_scheduling', blind);
    expect(first).toContain('NOTHING in your arguments names which one');
    expect(fakes.book_with_scheduling.execute).not.toHaveBeenCalled();

    // Second identical attempt: the guard has made its point and gets out of
    // the way, so the write actually happens and the checklist can resolve.
    expect(await call(toolkit.selectedTools(), 'book_with_scheduling', blind)).toContain('appt_1');
    expect(fakes.book_with_scheduling.execute).toHaveBeenCalledOnce();
  });

  it('SAD: a fresh offer restores the guard budget (stand-down is not permanent)', async () => {
    // The booking backend is down, so the stand-down write FAILS and the node
    // stays open — which is exactly the state in which a permanent stand-down
    // would be dangerous.
    const kit = makeKit({ bookResults: ['{"success":false,"error":"backend down"}'] });
    await call(kit.toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'caller_pays_us',
      trees: ['identity', 'booking'],
    });
    for (const [node_id, value] of [
      ['caller_name', 'Camille'],
      ['caller_phone', '2624979039'],
      ['meeting_topic', 'a position'],
    ] as const) {
      await call(kit.toolkit.selectedTools(), 'record_answer', { node_id, value });
    }
    await call(kit.toolkit.selectedTools(), 'get_available_slots', {});
    const blind = { window_from: '2026-08-17T01:00:00', window_to: '2026-08-21T17:00:00' };
    await call(kit.toolkit.selectedTools(), 'book_with_scheduling', blind); // refused
    await call(kit.toolkit.selectedTools(), 'book_with_scheduling', blind); // stands down, fails

    // New times put in front of the caller = a new choice outstanding. The very
    // next blind write must be refused again, not waved through on the old
    // exhausted budget.
    await call(kit.toolkit.selectedTools(), 'get_available_slots', {});
    expect(await call(kit.toolkit.selectedTools(), 'book_with_scheduling', blind)).toContain(
      'NOTHING in your arguments names which one'
    );
  });

  it('books once the caller names the time', async () => {
    const { toolkit, fakes } = await setUpOffer();
    await call(toolkit.selectedTools(), 'book_with_scheduling', {
      window_from: '2026-08-17T01:00:00',
      window_to: '2026-08-21T17:00:00',
    });
    expect(
      await call(toolkit.selectedTools(), 'book_with_scheduling', {
        requested_start: '2026-08-31T15:00:00',
      })
    ).toContain('appt_1');
    expect(fakes.book_with_scheduling.execute).toHaveBeenCalledOnce();
  });

  it('accepts a zero-width window as a chosen time (the shape CALL2 booked with)', async () => {
    const { toolkit, fakes } = await setUpOffer();
    expect(
      await call(toolkit.selectedTools(), 'book_with_scheduling', {
        window_from: '2026-08-31T15:00:00',
        window_to: '2026-08-31T15:00:00',
      })
    ).toContain('appt_1');
    expect(fakes.book_with_scheduling.execute).toHaveBeenCalledOnce();
  });

  it('SAD: never blocks a booking when no times were offered', async () => {
    // "Book me the next available" — nothing was put in front of the caller, so
    // there is no choice outstanding and a window-only booking is honest.
    const kit = makeKit();
    await call(kit.toolkit.selectedTools(), 'set_purpose', {
      work_direction: 'caller_pays_us',
      trees: ['identity', 'booking'],
    });
    for (const [node_id, value] of [
      ['caller_name', 'Camille'],
      ['caller_phone', '2624979039'],
      ['meeting_topic', 'a position'],
    ] as const) {
      await call(kit.toolkit.selectedTools(), 'record_answer', { node_id, value });
    }
    expect(
      await call(kit.toolkit.selectedTools(), 'book_with_scheduling', {
        window_from: '2026-08-17T13:00:00',
        window_to: '2026-08-21T17:00:00',
      })
    ).toContain('appt_1');
  });
});
