import { describe, expect, it } from 'vitest';
import type { llm } from '@livekit/agents';
import { buildChecklistPrompt, ChecklistAgent, resolveChecklistLibrary, resolveSelectableTreeIds } from './checklistAgent.js';
import { AUTO_SHOP_PRESET, LOCAL_SERVICE_PRESET, SALON_PRESET } from './presets.js';
import { materializeRuntimeConfig } from './runtimeConfig.js';
import { BOOKING_TREE, IDENTITY_TREE, JOB_TREE, MESSAGE_TREE, PLATFORM_TREE_LIBRARY } from './trees.js';

describe('resolveChecklistLibrary', () => {
  it('keeps the full live library available for tracker invariants', () => {
    const library = resolveChecklistLibrary({
      runtimeConfig: {
        preset_id: 'job_default',
        enabled_conversation_blocks: ['identity', 'job', 'booking', 'message'],
        enabled_policy_blocks: [],
        enabled_knowledge_blocks: [],
        enabled_outcome_blocks: [],
        overrides: {},
        version: 1,
      },
    });

    expect(library).toEqual(PLATFORM_TREE_LIBRARY);
  });

  it('compiles tenant runtime config into selectable live-tree ids', () => {
    const ids = resolveSelectableTreeIds({
      runtimeConfig: {
        preset_id: 'job_default',
        enabled_conversation_blocks: ['identity', 'job', 'booking', 'message'],
        enabled_policy_blocks: [],
        enabled_knowledge_blocks: [],
        enabled_outcome_blocks: [],
        overrides: {},
        version: 1,
      },
    });

    expect(ids).toEqual([IDENTITY_TREE, JOB_TREE, BOOKING_TREE, MESSAGE_TREE].map((tree) => tree.tree_id));
  });

  it('refuses ambiguous inputs when both a raw library and runtimeConfig are supplied', () => {
    expect(() =>
      resolveChecklistLibrary({
        library: [IDENTITY_TREE],
        runtimeConfig: {
          preset_id: 'job_default',
          enabled_conversation_blocks: ['identity'],
          enabled_policy_blocks: [],
          enabled_knowledge_blocks: [],
          enabled_outcome_blocks: [],
          overrides: {},
          version: 1,
        },
      })
    ).toThrow(/either library or runtimeConfig/i);
  });
});

describe('ChecklistAgent runtimeConfig path', () => {
  const runtime = {
    currentDate: 'Tuesday, August 11, 2026',
    timezone: 'America/Chicago',
    businessHours: 'Monday to Friday, 1:00 PM to 5:00 PM',
    bookableThrough: 'Friday, August 28, 2026',
  };

  it('uses the compiled library in both the prompt menu and set_purpose path', async () => {
    const library = resolveChecklistLibrary({
      runtimeConfig: {
        preset_id: 'job_default',
        enabled_conversation_blocks: ['identity', 'job', 'booking', 'message'],
        enabled_policy_blocks: [],
        enabled_knowledge_blocks: [],
        enabled_outcome_blocks: [],
        overrides: {},
        version: 1,
      },
    });
    const selectableTreeIds = resolveSelectableTreeIds({
      runtimeConfig: {
        preset_id: 'job_default',
        enabled_conversation_blocks: ['identity', 'job', 'booking', 'message'],
        enabled_policy_blocks: [],
        enabled_knowledge_blocks: [],
        enabled_outcome_blocks: [],
        overrides: {},
        version: 1,
      },
    });

    const prompt = buildChecklistPrompt({
      persona: 'You are Piper.',
      runtime,
      library,
      selectableTreeIds,
    });

    expect(prompt).toContain('- identity:');
    expect(prompt).toContain('- job:');
    expect(prompt).toContain('- booking:');
    expect(prompt).toContain('- message:');
    expect(prompt).not.toContain('- qa:');
    expect(prompt).not.toContain('- buy_service:');

    const agent = new ChecklistAgent({
      tools: {} as llm.ToolContext,
      persona: 'You are Piper.',
      runtime,
      runtimeConfig: {
        preset_id: 'job_default',
        enabled_conversation_blocks: ['identity', 'job', 'booking', 'message'],
        enabled_policy_blocks: [],
        enabled_knowledge_blocks: [],
        enabled_outcome_blocks: [],
        overrides: {},
        version: 1,
      },
    });

    const tools = agent.currentTools();
    const exec = (name: string, args: unknown) =>
      (tools[name] as unknown as { execute: (a: unknown, c: unknown) => Promise<unknown> }).execute(
        args,
        undefined
      );

    const ok = await exec('set_purpose', {
      work_direction: 'caller_offers_owner_work',
      trees: ['identity', 'job'],
    });
    expect(String(ok)).toContain('Purpose set: identity + job');

    const refused = await exec('set_purpose', {
      work_direction: 'neither_or_unclear',
      trees: ['qa'],
    });
    expect(String(refused)).toContain('No tree called "qa"');
  });

  it('auto shop preset keeps booking/message/qa/schedule-change available but blocks buy_service and job', async () => {
    const runtimeConfig = materializeRuntimeConfig(AUTO_SHOP_PRESET);
    const library = resolveChecklistLibrary({ runtimeConfig });
    const selectableTreeIds = resolveSelectableTreeIds({ runtimeConfig });
    const prompt = buildChecklistPrompt({
      persona: 'You are Piper.',
      runtime,
      library,
      selectableTreeIds,
    });

    expect(prompt).toContain('- booking:');
    expect(prompt).toContain('- message:');
    expect(prompt).toContain('- qa:');
    expect(prompt).toContain('- schedule_change:');
    expect(prompt).not.toContain('- buy_service:');
    expect(prompt).not.toContain('- job:');

    const agent = new ChecklistAgent({
      tools: {} as llm.ToolContext,
      persona: 'You are Piper.',
      runtime,
      runtimeConfig,
    });
    const tools = agent.currentTools();
    const exec = (name: string, args: unknown) =>
      (tools[name] as unknown as { execute: (a: unknown, c: unknown) => Promise<unknown> }).execute(
        args,
        undefined
      );

    const ok = await exec('set_purpose', {
      work_direction: 'caller_wants_something_from_business',
      trees: ['identity', 'booking'],
    });
    expect(String(ok)).toContain('Purpose set: identity + booking');

    const refused = await exec('set_purpose', {
      work_direction: 'caller_pays_us',
      trees: ['buy_service'],
    });
    expect(String(refused)).toContain('No tree called "buy_service"');
  });

  it('salon preset keeps booking/message/qa/schedule-change available but blocks buy_service and job', async () => {
    const runtimeConfig = materializeRuntimeConfig(SALON_PRESET);
    const library = resolveChecklistLibrary({ runtimeConfig });
    const selectableTreeIds = resolveSelectableTreeIds({ runtimeConfig });
    const prompt = buildChecklistPrompt({
      persona: 'You are Piper.',
      runtime,
      library,
      selectableTreeIds,
    });

    expect(prompt).toContain('- booking:');
    expect(prompt).toContain('- message:');
    expect(prompt).toContain('- qa:');
    expect(prompt).toContain('- schedule_change:');
    expect(prompt).not.toContain('- buy_service:');
    expect(prompt).not.toContain('- job:');

    const agent = new ChecklistAgent({
      tools: {} as llm.ToolContext,
      persona: 'You are Piper.',
      runtime,
      runtimeConfig,
    });
    const tools = agent.currentTools();
    const exec = (name: string, args: unknown) =>
      (tools[name] as unknown as { execute: (a: unknown, c: unknown) => Promise<unknown> }).execute(
        args,
        undefined
      );

    const ok = await exec('set_purpose', {
      work_direction: 'caller_wants_something_from_business',
      trees: ['identity', 'booking'],
    });
    expect(String(ok)).toContain('Purpose set: identity + booking');

    const refused = await exec('set_purpose', {
      work_direction: 'caller_pays_us',
      trees: ['buy_service'],
    });
    expect(String(refused)).toContain('No tree called "buy_service"');
  });

  it('local service preset exposes buy_service and generic_subject while still blocking job', async () => {
    const runtimeConfig = materializeRuntimeConfig(LOCAL_SERVICE_PRESET);
    const library = resolveChecklistLibrary({ runtimeConfig });
    const selectableTreeIds = resolveSelectableTreeIds({ runtimeConfig });
    const prompt = buildChecklistPrompt({
      persona: 'You are Piper.',
      runtime,
      library,
      selectableTreeIds,
    });

    expect(prompt).toContain('- booking:');
    expect(prompt).toContain('- message:');
    expect(prompt).toContain('- generic_subject:');
    expect(prompt).toContain('- qa:');
    expect(prompt).toContain('- buy_service:');
    expect(prompt).toContain('- schedule_change:');
    expect(prompt).not.toContain('- job:');

    const agent = new ChecklistAgent({
      tools: {} as llm.ToolContext,
      persona: 'You are Piper.',
      runtime,
      runtimeConfig,
    });
    const tools = agent.currentTools();
    const exec = (name: string, args: unknown) =>
      (tools[name] as unknown as { execute: (a: unknown, c: unknown) => Promise<unknown> }).execute(
        args,
        undefined
      );

    const ok = await exec('set_purpose', {
      work_direction: 'caller_pays_us',
      trees: ['buy_service'],
    });
    expect(String(ok)).toContain('Purpose set: buy_service');

    const refused = await exec('set_purpose', {
      work_direction: 'caller_offers_owner_work',
      trees: ['job'],
    });
    expect(String(refused)).toContain('No tree called "job"');
  });

  it('writes booking/message policy into the live prompt', () => {
    const prompt = buildChecklistPrompt({
      persona: 'You are Piper.',
      runtime,
      library: PLATFORM_TREE_LIBRARY,
      selectableTreeIds: ['identity', 'message'],
      runtimeConfig: {
        preset_id: 'salon_front_desk',
        enabled_conversation_blocks: ['identity', 'message'],
        enabled_policy_blocks: [],
        enabled_knowledge_blocks: [],
        enabled_outcome_blocks: [],
        overrides: { booking_mode: 'never', message_mode: 'fallback_only' },
        version: 1,
      },
    });
    expect(prompt).toContain('# Call policy');
    expect(prompt).toContain('Do NOT offer or book a time');
    expect(prompt).toContain('only when nothing else fits');
  });
});
