/**
 * buildChecklistPrompt — the system prompt for the question-tree flow.
 *
 * These guard the WRONG BUSINESS branch added 2026-07-22 after a live call
 * froze and hung up: "Is this Bob's waxing service?" was routed by "THE ELSE"
 * to a speculative message tree, which locked the goodbye gate on a caller who
 * had nothing to leave. The fix lives in the prompt (the host gate is
 * deliberately strict — see checklistTools.test.ts), so a prompt that loses
 * this guidance silently reopens the deadlock. These tests fail if it does.
 */
import { describe, it, expect } from 'vitest';
import { llm } from '@livekit/agents';
import { buildChecklistPrompt, ChecklistAgent, STALL_TURN_LIMIT } from './checklistAgent.js';
import { PLATFORM_TREE_LIBRARY } from './trees.js';

const prompt = buildChecklistPrompt({
  persona: 'You are Chris, the receptionist for Thinking Hammer.',
  runtime: {
    currentDate: 'Wednesday, July 22, 2026',
    timezone: 'America/Chicago',
    businessHours: 'Monday to Friday, 1:00 PM to 5:00 PM',
    bookableThrough: 'Friday, August 21, 2026',
  },
  library: PLATFORM_TREE_LIBRARY,
  callerPhone: '+12624979039',
});

describe('buildChecklistPrompt — wrong-business handling', () => {
  it('carries an explicit WRONG BUSINESS branch that answers in plain text and selects no tree', () => {
    // WHO: the "is this <other business>?" caller | WHERE: set_purpose guidance
    // WHY: selecting a tree here jams the goodbye gate — the exact freeze bug.
    expect(prompt).toMatch(/WRONG BUSINESS/);
    expect(prompt).toMatch(/do NOT select any tree/i);
    // The graceful answer the caller expected: restate who this business is.
    expect(prompt).toMatch(/No, this is/i);
  });

  it('gives a wrong-number EXIT — deselect via wrong_trees, then finish_call — if a tree was already selected', () => {
    // WHO: a model that speculatively selected before realizing the wrong number
    // WHY: the gate stays strict; the escape is removing the tree, not weakening
    //      the gate, so the caller is never stranded on dead air.
    expect(prompt).toMatch(/wrong_trees/);
    expect(prompt).toMatch(/finish_call/);
  });

  it('scopes THE ELSE so a bare identity question is NOT auto-routed to a message', () => {
    // WHO: THE ELSE catch-all | WHY: it used to fire message+generic_subject for
    // ANY unclassifiable input, including a wrong-number question — the trap.
    expect(prompt).toMatch(/wants something FROM THIS business/i);
  });
});

describe('the stall detector (SCL_nRKo3KEVw8Yh — five minutes of bot-mirror)', () => {
  // WHO: an AI recruiter bot mirroring "would you like me to leave a message?"
  //      at the agent for 5 minutes, the checklist frozen the whole time.
  // WHAT: onUserTurnCompleted compares the tracker's mutation count across
  //       caller turns; STALL_TURN_LIMIT stationary turns → one system note:
  //       stop re-asking, summarize, wrap up. Re-arms when the checklist moves.
  // WHY: every individual turn looked like conversation — only host state can
  //      see that the conversation is going nowhere.
  function makeAgent() {
    return new ChecklistAgent({
      tools: {} as llm.ToolContext,
      persona: 'You are Piper, the receptionist for Thinking Hammer.',
      runtime: {
        currentDate: 'Thursday, July 30, 2026',
        timezone: 'America/Chicago',
        businessHours: 'Monday to Friday, 1:00 PM to 5:00 PM',
        bookableThrough: 'Friday, August 28, 2026',
      },
    });
  }

  it('injects the wrap-up note after STALL_TURN_LIMIT stationary turns — and only once', async () => {
    const agent = makeAgent();
    const ctx = llm.ChatContext.empty();
    const fakeMsg = {} as llm.ChatMessage;
    for (let i = 0; i < STALL_TURN_LIMIT + 2; i++) {
      await agent.onUserTurnCompleted(ctx, fakeMsg);
    }
    const notes = ctx.items.filter(
      (it) => it.type === 'message' && it.role === 'system'
    );
    expect(notes).toHaveLength(1); // fires once per stall, never spams
    expect(JSON.stringify(notes[0])).toContain('summarize');
  });

  it('checklist movement resets the counter — a working call never sees the note', async () => {
    const agent = makeAgent();
    const ctx = llm.ChatContext.empty();
    const fakeMsg = {} as llm.ChatMessage;
    const tools = agent.currentTools();
    const exec = (name: string, args: unknown) =>
      (tools[name] as unknown as { execute: (a: unknown, c: unknown) => Promise<unknown> }).execute(
        args,
        undefined
      );
    for (let i = 0; i < 6; i++) {
      // Every turn moves the checklist (a new selection or answer) — no stall.
      if (i === 0) await exec('set_purpose', { trees: ['identity'] });
      else await exec('record_answer', { node_id: 'caller_name', value: `Name${i}` });
      await agent.onUserTurnCompleted(ctx, fakeMsg);
    }
    expect(ctx.items.filter((it) => it.type === 'message' && it.role === 'system')).toHaveLength(0);
  });
});

describe('the Known caller section (batch A — the CRM snapshot reaches the LIVE path)', () => {
  // WHO: SCL_VcKTTgo4kS2v (2026-07-27, CALL_IMPROVEMENTS.md #8) — a caller with
  //      a live 2:30 appointment, phone-matched in the DB, told "you don't have
  //      a booked time on file". The snapshot was prefetched on every call and
  //      handed only to the ladder prompt, which prod never runs.
  const runtime = {
    currentDate: 'Thursday, July 30, 2026',
    timezone: 'America/Chicago',
    businessHours: 'Monday to Friday, 1:00 PM to 5:00 PM',
    bookableThrough: 'Friday, August 28, 2026',
  };

  it('renders the returning caller: appointments lead, in tenant-local words, with the never-deny rule', () => {
    const p = buildChecklistPrompt({
      persona: 'You are Piper.',
      runtime,
      library: PLATFORM_TREE_LIBRARY,
      knownCustomer: {
        name: 'Jaya',
        history: 'Booked a meeting about a Java contract',
        preferences: { preferred_contact: 'phone' },
        // 19:30 UTC = 2:30 PM America/Chicago — the live call's exact booking.
        upcomingAppointments: [
          { start_time: '2026-07-27T19:30:00.000Z', service: 'Programming Consultation' },
        ],
      },
    });
    expect(p).toContain('# Known caller');
    expect(p).toContain('Jaya');
    expect(p).toContain('2:30 PM'); // tenant-local, speakable — never raw ISO
    expect(p).toContain('Programming Consultation');
    expect(p).toContain('NEVER tell this caller they have no booking');
    expect(p).toContain('Booked a meeting about a Java contract');
  });

  it('known caller with NO appointments: directed to CHECK before denying, never assert from silence', () => {
    const p = buildChecklistPrompt({
      persona: 'You are Piper.',
      runtime,
      library: PLATFORM_TREE_LIBRARY,
      knownCustomer: { name: 'Dale', history: '', preferences: {}, upcomingAppointments: [] },
    });
    expect(p).toContain('# Known caller');
    expect(p).toContain('never assert');
    expect(p).toContain('get_my_appointments');
  });

  it('unknown caller: no Known-caller section, but the tool-gated-bookings rule still stands', () => {
    const p = buildChecklistPrompt({
      persona: 'You are Piper.',
      runtime,
      library: PLATFORM_TREE_LIBRARY,
      knownCustomer: null,
    });
    expect(p).not.toContain('# Known caller');
    expect(p).toContain('EXISTING BOOKINGS ARE TOOL-GATED FACTS');
  });
});
