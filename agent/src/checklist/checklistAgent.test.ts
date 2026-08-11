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
    // Wording tightened 2026-08-04 — the correction now leads with an apology and
    // is followed by what the business DOES plus an offer, because the bare
    // one-sentence "no" this used to assert is what left callers on dead air.
    expect(prompt).toMatch(/No, sorry\s*—\s*this is/i);
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
    const notes = ctx.items.filter((it) => it.type === 'message' && it.role === 'system');
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

describe('batch B — the Jaya-cascade prompt guarantees', () => {
  const runtime = {
    currentDate: 'Tuesday, July 21, 2026',
    timezone: 'America/Chicago',
    businessHours: 'Monday to Friday, 1:00 PM to 5:00 PM',
    bookableThrough: 'Friday, August 28, 2026',
  };
  const build = (over: Partial<Parameters<typeof buildChecklistPrompt>[0]> = {}) =>
    buildChecklistPrompt({
      persona: 'You are Piper.',
      runtime,
      library: PLATFORM_TREE_LIBRARY,
      ...over,
    });

  it('the roster is named, and an unknown name must be QUESTIONED, never repeated as fact', () => {
    // WHO: the caller who asked for "Jane" — STT for "Dale", the only employee
    //      — and was confirmed into a meeting "with Jane" (2026-07-27, #10).
    const p = build({ staffFirstNames: ['Dale', 'Maria'] });
    expect(p).toContain('WHO WORKS HERE: Dale, Maria');
    expect(p).toContain('Do you mean Dale?');
    expect(p).toMatch(/never book, or say you booked, with a person who is not on this list/i);
  });

  it('no roster configured → no roster line at all (never an empty list read aloud)', () => {
    const p = build({ staffFirstNames: [] });
    expect(p).not.toContain('WHO WORKS HERE');
  });

  it('names the tenant zone and demands conversion when the caller states their own', () => {
    // WHO: the caller who said "2:30 EST" and was booked at 2:30 CENTRAL —
    //      an hour off what she agreed to (2026-07-27, #9).
    const p = build();
    expect(p).toContain('TIMES ARE IN America/Chicago');
    expect(p).toMatch(/2:30 Eastern is 1:30 our time/);
    expect(p).toMatch(/never\s+guess a zone from an area code/i);
  });

  it('forbids improvising what happens at the appointment, and points at what_happens_next', () => {
    // The single sentence that cost four follow-up calls: "call Dale directly…
    // you can use the same number" — the AI receptionist's own line.
    const p = build();
    expect(p).toContain('what_happens_next');
    expect(p).toMatch(/do NOT invent an answer/i);
  });

  it('records only what the caller SAID — a hedged mention is not an answer', () => {
    // "we place people at companies like Capgemini" must not become a
    // Capgemini role (the provenance gap found while auditing call #1).
    const p = build();
    expect(p).toMatch(/companies like Capgemini/);
    expect(p).toMatch(/ask one plain question to confirm it/i);
  });
});

/**
 * ORIENTATION + NEVER-GO-SILENT.
 *
 * Origin (owner, 2026-08-04): "many people are baffled" by reaching an AI. They
 * open by asking what this is, whether it is a real person, or whether they got
 * Dale's phone — anything but an answer to "how can I help you?" The failure
 * being prevented is the agent treating that as noise and going quiet, which
 * reads to the caller as a dropped line.
 *
 * The ROOT CAUSE was not missing instructions. The persona line was the only
 * thing the model knew about the business, and the prompt forbids inventing
 * services — so on "is this Barb's Waxing?" it had nothing true to say past a
 * bare "no", and stopped. These tests pin BOTH halves: the facts, and the rule.
 */
describe('buildChecklistPrompt — orientation, off-topic, and never going silent', () => {
  const withBusiness = buildChecklistPrompt({
    persona: 'You are Chris, the receptionist for Thinking Hammer.',
    runtime: {
      currentDate: 'Wednesday, July 22, 2026',
      timezone: 'America/Chicago',
      businessHours: 'Monday to Friday, 1:00 PM to 5:00 PM',
      bookableThrough: 'Friday, August 21, 2026',
    },
    library: PLATFORM_TREE_LIBRARY,
    businessName: 'Thinking Hammer LLC',
    businessBlurb: 'We build software and AI phone assistants for small businesses.',
  });

  // WHO: the "what is this?" caller | WHAT: the model has a true description to give |
  // WHEN: any orientation question | WHERE: "# What this business is" | WHY: this is the
  // fact whose absence caused the silence. Without it the only honest answer is "no".
  it('HAPPY: carries the business name and the owner-written blurb as FACTS', () => {
    expect(withBusiness).toContain('# What this business is');
    expect(withBusiness).toContain('Thinking Hammer LLC');
    expect(withBusiness).toContain('We build software and AI phone assistants');
  });

  // WHO: a tenant with no greeting_menu configured | WHAT: an explicit fallback |
  // WHEN: blurb is null | WHERE: business section | WHY: the absence of a blurb must
  // produce "say what you can DO", never an invented description of the business.
  it('SAD: with no blurb configured, forbids inventing one', () => {
    const noBlurb = buildChecklistPrompt({
      persona: 'You are Chris.',
      runtime: {
        currentDate: 'Wednesday, July 22, 2026',
        timezone: 'America/Chicago',
        businessHours: null,
        bookableThrough: null,
      },
      library: PLATFORM_TREE_LIBRARY,
      businessName: 'Thinking Hammer LLC',
      businessBlurb: null,
    });
    expect(noBlurb).toContain('never invent a description');
  });

  // WHO: every caller | WHAT: the absolute rule | WHEN: every turn | WHERE: conversation
  // rules | WHY: the owner's instruction was explicit — "NOT JUST GO SILENT". A turn that
  // ends without speech reads as a dropped call.
  it('HAPPY: states that every turn ends in speech and silence is never correct', () => {
    expect(withBusiness).toContain('NEVER GO SILENT');
    expect(withBusiness).toMatch(/Every single turn you take ends in speech/);
  });

  // WHO: the baffled first-time caller | WHAT: answer-then-steer, in that order |
  // WHEN: they ask instead of answering | WHERE: orientation block | WHY: answering a
  // question with a question is what makes people repeat themselves and hang up.
  it('HAPPY: instructs ANSWER FIRST, then one easy question back', () => {
    expect(withBusiness).toContain('ANSWER FIRST, THEN STEER');
    expect(withBusiness).toContain('Never answer a question with a question');
    // An orientation question is not a purpose. The eval caught the model calling
    // set_purpose on "is this <owner>'s phone?", which puts unasked-for questions
    // on the checklist and lets the goodbye gate hold the call open on them.
    expect(withBusiness).toMatch(/NONE OF THOSE IS A PURPOSE/);
    expect(withBusiness).toMatch(/Do NOT call set_purpose on an orientation question/);
  });

  // WHO: "am I talking to a robot?" | WHAT: honest disclosure, no evasion | WHEN: asked
  // directly | WHERE: orientation examples | WHY: denying it is both a trust failure and,
  // in several states, a legal one. The greeting already discloses; this keeps the
  // mid-call answer consistent with it.
  it('HAPPY: answers "are you a real person" honestly and never denies being an AI', () => {
    expect(withBusiness).toContain('Never deny it');
    expect(withBusiness).toMatch(/I'm an AI assistant/);
  });

  // WHO: a caller making small talk | WHAT: a human reply, then a bridge | WHEN: off-topic
  // | WHERE: OFF-TOPIC block | WHY: the owner asked for a chatbot that talks back and then
  // steers — not one that stonewalls or that answers a joke with a checklist question.
  it('HAPPY: permits real small talk but requires every reply to bridge back', () => {
    expect(withBusiness).toContain('IDLE CHAT IS FINE');
    expect(withBusiness).toContain('TALK BACK LIKE A PERSON');
    // Engage with the substance, not a generic acknowledgement.
    expect(withBusiness).toMatch(/react to the substance/);
    // Permission to engage with the SUBJECT briefly, with real content in it —
    // a warm-but-empty "That's nice!" reads as a machine waiting for you to finish.
    expect(withBusiness).toMatch(/ACTUALLY TALK ABOUT THEIR TOPIC/);
    expect(withBusiness).toMatch(/worse than none/);
    // ...but the agent steers it home; the call must not be lost in the chatting.
    expect(withBusiness).toMatch(/THEN LEAD THEM BACK/);
    expect(withBusiness).toMatch(/never LOSE the call in the\s+chatting/);
    expect(withBusiness).toMatch(/never let the reason they called go\s+unasked/);
  });

  // WHO: any caller making small talk | WHAT: tone guardrail | WHEN: idle chat |
  // WHERE: KEEP IT LIGHT AND KIND | WHY: this is the first thing a stranger hears from
  // the business. Negativity, sarcasm or an opinion on politics/illness/money costs the
  // owner a customer, and forced cheerfulness reads as fake.
  it('HAPPY: requires warm-neutral tone and forbids negative or edgy chat', () => {
    expect(withBusiness).toMatch(/KEEP IT LIGHT AND KIND/);
    expect(withBusiness).toMatch(/never negative/);
    expect(withBusiness).toMatch(/sarcastic, edgy or strange/);
    expect(withBusiness).toMatch(/politics, religion, illness/);
    // Not the opposite failure either — relentless cheerfulness reads as fake.
    expect(withBusiness).toMatch(/forced cheerfulness reads as fake/);
  });

  // WHO: a caller chatting with an AI | WHAT: no fabricated personal life | WHEN: small
  // talk | WHERE: DO NOT INVENT A PERSONAL LIFE | WHY: an assistant that claims a dog or
  // a commute is asserting something untrue, and it directly contradicts answering "are
  // you a real person?" honestly two paragraphs earlier.
  it('HAPPY: forbids inventing personal experiences it cannot have', () => {
    expect(withBusiness).toMatch(/DO NOT INVENT A PERSONAL LIFE/);
    expect(withBusiness).toMatch(/Never claim experiences you cannot have/);
    // And the worked examples must not model the failure.
    expect(withBusiness).not.toMatch(/Ours ate a remote/);
    expect(withBusiness).not.toMatch(/my coffee went cold/);
    // The OPPOSITE failure: lecturing the caller about being an AI. Acknowledge
    // once, lightly, then get back to their call.
    expect(withBusiness).toMatch(/no speech about your nature/);
    expect(withBusiness).toMatch(/Do not\s+apologise for being an AI/);
    expect(withBusiness).toMatch(/Light and realistic/);
  });

  // WHO: a caller who wanders instead of answering | WHAT: the question is re-asked, not
  // recorded and not skipped | WHEN: a tangent lands where an answer should be | WHERE:
  // A NON-ANSWER IS NOT AN ANSWER | WHY: a checklist filled with near-misses is worse than
  // an empty one, because the owner acts on it.
  it('HAPPY: refuses to record a tangent as an answer and re-asks the same question', () => {
    expect(withBusiness).toMatch(/A NON-ANSWER IS NOT AN ANSWER/);
    expect(withBusiness).toMatch(/put\s+the\s+SAME question back/);
    expect(withBusiness).toMatch(/never fill in a plausible answer they never actually gave/);
  });

  // WHO: vague "hello / what is this?" opener | WHAT: capability menu in prompt |
  // WHEN: first turn before purpose is known | WHERE: "# What I can do for you" |
  // WHY (plan 08-10-2026): model had nothing concrete to offer after orientation beyond a
  // bare name — it went quiet or looped. The list is the thing it can say. Service detail
  // stays in the owner-written blurb (no hardcoded person names — multi-tenant).
  it('HAPPY: includes the capability menu (tenant-neutral) and defers services to the blurb', () => {
    expect(withBusiness).toContain('# What I can do for you');
    expect(withBusiness).toMatch(/take a message for the owner/);
    expect(withBusiness).toMatch(/help you pick a service and book an appointment/);
    expect(withBusiness).toMatch(/use only the facts in "# What this business is"/);
    expect(withBusiness).toMatch(/schedule a time simply to talk with the owner/);
    // No real person name may leak into the platform prompt for every tenant.
    expect(withBusiness).not.toMatch(/\bDale\b/);
  });

  // WHO: tenant with no greeting_menu | WHAT: capability still has a no-invent fallback |
  // WHEN: businessBlurb is absent | WHERE: capability section | WHY: Copilot review —
  // referencing a missing "# What this business is" section is an impossible instruction.
  it('HAPPY: without a blurb, capability lists three lanes and forbids inventing services', () => {
    const noBiz = buildChecklistPrompt({
      persona: 'You are Chris.',
      runtime: {
        currentDate: 'Wednesday, July 22, 2026',
        timezone: 'America/Chicago',
        businessHours: null,
        bookableThrough: null,
      },
      library: PLATFORM_TREE_LIBRARY,
    });
    expect(noBiz).toContain('# What I can do for you');
    // No populated business section (other rules may still mention the heading by name).
    expect(noBiz).not.toMatch(/# What this business is\n/);
    expect(noBiz).toMatch(/no business description is configured/);
    expect(noBiz).toMatch(/never\s+invent services/);
  });

  // WHO: a tenant with a single staff first name | WHAT: capability uses that name |
  // WHEN: staffFirstNames is provided | WHERE: capability menu | WHY: "message for the
  // owner" is colder than "message for Jane" when we already know who works there.
  it('HAPPY: capability menu names the sole staff person when the roster has one name', () => {
    const withStaff = buildChecklistPrompt({
      persona: 'You are Chris.',
      runtime: {
        currentDate: 'Wednesday, July 22, 2026',
        timezone: 'America/Chicago',
        businessHours: null,
        bookableThrough: null,
      },
      library: PLATFORM_TREE_LIBRARY,
      businessName: 'Acme Shop',
      staffFirstNames: ['Jordan'],
    });
    expect(withStaff).toMatch(/take a message for Jordan/);
    expect(withStaff).toMatch(/talk with Jordan/);
  });

  // WHO: "yeah / uh-huh" vs "what? / I don't get it" | WHAT: filler ignored, real interrupt
  // handled | WHEN: mid-checklist acknowledgments and clarification asks | WHERE: FILLER
  // VS REAL INTERRUPTION | WHY (plan 08-10-2026): empty noise must not re-ask or re-route;
  // a real "wait I don't get it" must not be treated as an answer.
  it('HAPPY: distinguishes filler noise from real clarification requests', () => {
    expect(withBusiness).toMatch(/FILLER VS REAL INTERRUPTION/);
    expect(withBusiness).toMatch(/Ignore empty noise/);
    expect(withBusiness).toMatch(/uh-huh/);
    expect(withBusiness).toMatch(/REAL clarification request/);
    expect(withBusiness).toMatch(/what part is confusing/);
  });

  // WHO: a caller re-asked too many times | WHAT: escalation, then an exit | WHEN: third
  // attempt | WHERE: same block | WHY: asking a fourth time is the loop callers hang up on.
  it('HAPPY: caps re-asking and changes shape rather than looping', () => {
    expect(withBusiness).toMatch(/Third time on the same question/);
    expect(withBusiness).toMatch(/Never ask the same question a fourth time/);
  });

  // WHO: "never mind, I'll book later" | WHAT: the tree is released AND alternatives are
  // offered | WHEN: the caller backs out | WHERE: THEY CHANGED THEIR MIND | WHY: a dropped
  // goal left selected freezes the goodbye gate — the same jam as the wrong-number freeze —
  // and "okay, bye" sends away someone who still wanted something.
  it('HAPPY: on a change of mind, releases the tree and offers the other options', () => {
    expect(withBusiness).toMatch(/THEY CHANGED THEIR MIND/);
    expect(withBusiness).toMatch(/Remove that tree with set_purpose \(wrong_trees\)/);
    expect(withBusiness).toMatch(/OFFER WHAT IS LEFT/);
    expect(withBusiness).toMatch(/do not just say "okay" and hang up/);
    // SPEAK FIRST. The eval caught the model spending its whole turn on the
    // set_purpose call and saying NOTHING — the caller says "never mind" and
    // hears silence. Ordering the instruction tool-first is what caused it.
    expect(withBusiness).toMatch(/SPEAK IN THE SAME TURN/);
    expect(withBusiness).toMatch(/SPEAK FIRST/);
    expect(withBusiness).toMatch(/only a set_purpose call and no words is DEAD AIR/);
  });

  // WHO: a caller who declines the alternative too | WHAT: one offer, not three | WHEN:
  // second refusal | WHERE: same block | WHY: pushing past a second no loses the customer.
  it('HAPPY: accepts a second refusal instead of pushing', () => {
    expect(withBusiness).toMatch(/one offer, not three/);
    expect(withBusiness).toMatch(/Pushing after a second no/);
  });

  // WHO: a caller on bad phone audio | WHAT: an explicit repair line | WHEN: STT garbles
  // them | WHERE: repair block | WHY: there was NO no-match handling anywhere in the agent
  // before this — grep for "didn't catch" returned nothing. Guessing books the wrong thing.
  it('HAPPY: gives an explicit repair line instead of guessing or stalling', () => {
    expect(withBusiness).toMatch(/didn't\s+catch that/);
    expect(withBusiness).toContain('do not guess and do not stall');
  });

  // WHO: the wrong-number caller | WHAT: a real answer, not a bare "no" | WHEN: "is this
  // Barb's Waxing?" | WHERE: WRONG BUSINESS branch | WHY: the previous rule said answer in
  // ONE plain sentence and "let them steer" — which is precisely the dead air the owner
  // reported. The answer now carries what the business does and ends in an offer.
  it('HAPPY: wrong-business answer names the business, says what it does, and offers a way in', () => {
    expect(withBusiness).toContain('do NOT answer with a bare "no"');
    expect(withBusiness).toContain('Say what this business actually does');
    expect(withBusiness).toMatch(/anything there I can help with/i);
  });
});
