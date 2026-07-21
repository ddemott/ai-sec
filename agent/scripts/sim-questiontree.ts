/**
 * QUESTION-TREE MOCK CALLS — a LIVE LLM plays the caller against the REAL
 * conversation layer. Question-tree phase 4, step 1
 * (docs/QUESTION_TREE_ARCHITECTURE.md §4.4).
 *
 * What is REAL: the ChecklistAgent prompt (buildChecklistPrompt), the real
 * toolset (createChecklistTools over the real ChecklistTracker + the real
 * platform trees), and both LLMs — the agent model converses and records, a
 * second LLM improvises as the caller with a persona, differently every run.
 *
 * What is FAKED: the backend tools (book/take_message/capture/RAG return
 * canned success JSON). That is the point of this tier — it grades whether the
 * MODEL can drive the checklist through a real conversation, and it grades on
 * the TRACKER'S FINAL SNAPSHOT (structured ground truth), not transcript
 * pattern-matching. The full-backend + DB-verified tier is the sim-taskgroup
 * pattern and comes when this tier is clean.
 *
 * Run:  cd agent && npx tsx scripts/sim-questiontree.ts
 *   env: OPENAI_API_KEY (repo-root .env is loaded)
 *   SIM_CASE=<substr>      run only matching scenarios
 *   SIM_RUNS=N             runs per scenario (default 1)
 *   SIM_TRACE=1            print every line + tool call
 *   SIM_QT_MODEL=…         agent model (default gpt-4.1-mini — the prod voice LLM)
 *   SIM_CALLER_MODEL=…     caller model (default gpt-4o-mini)
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: new URL('../../.env', import.meta.url).pathname });
loadEnv(); // agent-local .env, if any, wins for agent-specific vars

import type { llm } from '@livekit/agents';
import { ChecklistTracker } from '../src/checklist/tracker.js';
import { createChecklistTools } from '../src/checklist/checklistTools.js';
import { buildChecklistPrompt } from '../src/checklist/checklistAgent.js';
import { PLATFORM_TREE_LIBRARY } from '../src/checklist/trees.js';
import type { NodeStatus } from '../src/checklist/types.js';

const API_KEY = process.env.OPENAI_API_KEY;
const AGENT_MODEL = process.env.SIM_QT_MODEL || 'gpt-4.1-mini';
const CALLER_MODEL = process.env.SIM_CALLER_MODEL || 'gpt-4o-mini';

// PROVIDER BAKE-OFF (2026-07-21): the AGENT (the thing under test) can point at
// any OpenAI-compatible endpoint — DeepSeek, Groq, Together, a local model —
// while the simulated CALLER stays on OpenAI (only the variable under test may
// change). Set all three to test a provider:
//   SIM_QT_BASE_URL=https://api.deepseek.com/v1 SIM_QT_API_KEY=$DEEPSEEK_API_KEY SIM_QT_MODEL=deepseek-chat
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const AGENT_BASE = (process.env.SIM_QT_BASE_URL || '').replace(/\/+$/, '');
const AGENT_URL = AGENT_BASE ? `${AGENT_BASE}/chat/completions` : OPENAI_URL;
const AGENT_KEY = process.env.SIM_QT_API_KEY || API_KEY;
const CASE_FILTER = process.env.SIM_CASE || '';
const RUNS = Number(process.env.SIM_RUNS || 1);
const TRACE = !!process.env.SIM_TRACE;

const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', d: '', b: '', x: '' };

if (!API_KEY) throw new Error('OPENAI_API_KEY not set');

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function openai(
  model: string,
  temperature: number,
  messages: ChatMessage[],
  tools?: { type: 'function'; function: unknown }[]
): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  // The AGENT model (passed AGENT_MODEL) uses the configurable endpoint; every
  // other call (the caller model) stays on OpenAI. Route by which model this is.
  const isAgent = model === AGENT_MODEL;
  const url = isAgent ? AGENT_URL : OPENAI_URL;
  const key = isAgent ? AGENT_KEY : API_KEY;
  const who = isAgent && AGENT_BASE ? `agent-provider(${new URL(AGENT_URL).host})` : 'OpenAI';
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature,
        messages,
        ...(tools ? { tools, tool_choice: 'auto' } : {}),
      }),
    }).catch(() => null);
    if (res?.ok) {
      const j = (await res.json()) as {
        choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[];
      };
      const m = j.choices[0]?.message;
      return { content: m?.content ?? null, toolCalls: m?.tool_calls ?? [] };
    }
    if (res && res.status !== 429 && res.status < 500) {
      throw new Error(`${who} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    await sleep(Math.min(1500 * 2 ** (attempt - 1), 15_000));
  }
  throw new Error(`${who} unreachable after retries`);
}

function toolSchemas(ctx: llm.ToolContext): { type: 'function'; function: unknown }[] {
  return Object.entries(ctx).map(([name, t]) => {
    const s = t as unknown as { description: string; parameters: Record<string, unknown> };
    return {
      type: 'function' as const,
      function: { name, description: s.description, parameters: s.parameters },
    };
  });
}

// ── Faked backend tools (canned success; call-counted for grading) ────────────

interface Fake {
  description: string;
  parameters: Record<string, unknown>;
  execute: (a: unknown, o: unknown) => Promise<string>;
  calls: unknown[];
}
const fake = (description: string, params: Record<string, unknown>, result: string): Fake => {
  const f: Fake = {
    description,
    parameters: { type: 'object', properties: params, required: Object.keys(params) },
    calls: [],
    execute: async (a: unknown) => {
      f.calls.push(a);
      return result;
    },
  };
  return f;
};

function makeFakeBackend(): Record<string, Fake> {
  const str = { type: 'string' } as const;
  return {
    book_with_scheduling: fake(
      'Book the appointment at a settled time. Pass start_time (spoken time) and any known details.',
      { start_time: str },
      JSON.stringify({
        success: true,
        appointment_id: 'appt_sim_1',
        booked_time: 'Tuesday, July 22 at 1:15 PM',
        instruction: 'Booked for Tuesday, July 22 at 1:15 PM. Confirm THIS exact time.',
      })
    ),
    get_available_slots: fake(
      'Get real bookable open times for a requested day.',
      { day: str },
      JSON.stringify({
        success: true,
        open_times: ['Tuesday, July 22 at 1:15 PM', '2:45 PM', '4:30 PM'],
      })
    ),
    get_service_catalog: fake(
      'List the services offered.',
      {},
      JSON.stringify({ success: true, services: [{ name: 'Programming Consultation' }] })
    ),
    take_message: fake(
      'Save a message for the owner. Pass the message text.',
      { message: str },
      JSON.stringify({ success: true, message_id: 'msg_sim_1' })
    ),
    capture_job_inquiry: fake(
      'Record a job/role inquiry for the owner. Pass whatever role details were collected.',
      { role: str },
      JSON.stringify({ success: true, job_inquiry_id: 'ji_sim_1' })
    ),
    identify_caller: fake(
      'Save the caller to the address book.',
      { name: str, phone: str },
      JSON.stringify({ success: true, customer_id: 'cust_sim_1' })
    ),
    get_company_policy_answer: fake(
      "Answer a question about the business from the knowledge base.",
      { question: str },
      JSON.stringify({
        success: true,
        answer:
          'Dale has 25 years of software experience, mostly embedded systems and more ' +
          'recently AI platforms. Consultations run Monday to Friday, 1 to 5 PM.',
      })
    ),
    cancel_appointment: fake(
      'Cancel an existing appointment.',
      {},
      JSON.stringify({ success: true, appointment_id: 'appt_sim_9' })
    ),
    reschedule_appointment: fake(
      'Move an existing appointment to a new time.',
      {},
      JSON.stringify({ success: true, appointment_id: 'appt_sim_9' })
    ),
    get_my_appointments: fake(
      'Look up the caller’s existing appointments.',
      {},
      JSON.stringify({
        success: true,
        appointments: [{ appointment_id: 'appt_sim_9', start: 'Thursday 2 PM' }],
      })
    ),
  };
}

// ── The caller ────────────────────────────────────────────────────────────────

interface Persona {
  opener: string;
  facts: string;
  behaviour: string;
}

function personaSystem(p: Persona): string {
  return `You are a real person on a PHONE CALL to a small business called Thinking Hammer.
You called them; a receptionist answers. Speak ONE short natural spoken line per turn — no
stage directions, no lists, no quotes around your words.

WHY you called (open with this, in your own words): ${p.opener}

FACTS YOU HOLD (give them when asked — or as your behaviour says; NEVER invent facts not
listed; if asked something not here, say you don't know or would rather not say):
${p.facts}

BEHAVIOUR: ${p.behaviour}

When the receptionist asks "anything else?", say no thanks. If they read a number or
detail back correctly, confirm it. End politely.`;
}

async function callerReply(personaSys: string, shared: ChatMessage[]): Promise<string> {
  const view: ChatMessage[] = [{ role: 'system', content: personaSys }];
  for (const m of shared) {
    if (m.role === 'assistant' && m.content) view.push({ role: 'user', content: m.content });
    else if (m.role === 'user' && m.content) view.push({ role: 'assistant', content: m.content });
  }
  const { content } = await openai(CALLER_MODEL, 0.9, view);
  return (content ?? 'Okay.').trim();
}

// ── The call loop ─────────────────────────────────────────────────────────────

interface RunOutcome {
  tracker: ChecklistTracker;
  fakes: Record<string, Fake>;
  /** Backend tool names in the order they fired — for ordering graders. */
  toolOrder: string[];
  transcript: { who: 'agent' | 'caller'; text: string }[];
  closed: boolean;
  goodbye: string;
}

async function runCall(p: Persona, callerPhone?: string): Promise<RunOutcome> {
  const tracker = new ChecklistTracker(PLATFORM_TREE_LIBRARY);
  const fakes = makeFakeBackend();
  const toolOrder: string[] = [];
  for (const [name, f] of Object.entries(fakes)) {
    const orig = f.execute;
    f.execute = async (a, o) => {
      toolOrder.push(name);
      return orig(a, o);
    };
  }
  let closed = false;
  let goodbye = '';
  const toolkit = createChecklistTools({
    tracker,
    library: PLATFORM_TREE_LIBRARY,
    realTools: fakes as unknown as llm.ToolContext,
    callerPhone,
    onSelectionChanged: () => {}, // schemas are rebuilt fresh every round below
    closeCall: async (g: string) => {
      closed = true;
      goodbye = g;
    },
  });

  const system = buildChecklistPrompt({
    persona: 'You are Chris, the AI receptionist for Thinking Hammer.',
    runtime: {
      currentDate: 'Monday, July 21, 2026',
      timezone: 'America/Chicago',
      businessHours: 'Monday to Friday, 1:00 PM to 5:00 PM',
      bookableThrough: 'Friday, August 15, 2026',
    },
    library: PLATFORM_TREE_LIBRARY,
    callerPhone,
  });

  const personaSys = personaSystem(p);
  const transcript: RunOutcome['transcript'] = [];
  const shared: ChatMessage[] = [];
  const messages: ChatMessage[] = [{ role: 'system', content: system }];

  const greeting = 'Thank you for calling Thinking Hammer — this is Chris. How can I help you?';
  transcript.push({ who: 'agent', text: greeting });
  messages.push({ role: 'assistant', content: greeting });
  const opener = await callerReply(personaSys, [{ role: 'assistant', content: greeting }]);
  transcript.push({ who: 'caller', text: opener });
  shared.push({ role: 'assistant', content: greeting });
  shared.push({ role: 'user', content: opener });
  messages.push({ role: 'user', content: opener });
  if (TRACE) process.stderr.write(`   agent: ${greeting}\n   caller: ${opener}\n`);

  for (let round = 0; round < 48 && !closed; round++) {
    const tools = toolkit.selectedTools(); // fresh every round — selection may have changed
    const { content, toolCalls } = await openai(AGENT_MODEL, 0, messages, toolSchemas(tools));

    if (toolCalls.length > 0) {
      messages.push({ role: 'assistant', content: content ?? null, tool_calls: toolCalls });
      if (content?.trim()) {
        transcript.push({ who: 'agent', text: content });
        shared.push({ role: 'assistant', content });
        if (TRACE) process.stderr.write(`   agent: ${content}\n`);
      }
      for (const tc of toolCalls) {
        const tool = tools[tc.function.name] as
          | { execute: (a: unknown, o: unknown) => Promise<unknown> }
          | undefined;
        let res: unknown = `unknown tool ${tc.function.name}`;
        if (tool) {
          let args: unknown = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            /* {} */
          }
          res = await (tool as unknown as { execute: (a: unknown, o: unknown) => Promise<unknown> })
            .execute(args, { toolCallId: tc.id });
        }
        const rs = typeof res === 'string' ? res : JSON.stringify(res);
        if (TRACE)
          process.stderr.write(
            `      [tool] ${tc.function.name}(${(tc.function.arguments || '').slice(0, 100)}) -> ${rs.slice(0, 160)}\n`
          );
        messages.push({ role: 'tool', tool_call_id: tc.id, content: rs });
      }
      continue;
    }

    const agentLine = (content ?? '').trim();
    messages.push({ role: 'assistant', content: agentLine });
    if (agentLine) {
      transcript.push({ who: 'agent', text: agentLine });
      shared.push({ role: 'assistant', content: agentLine });
      if (TRACE) process.stderr.write(`   agent: ${agentLine}\n`);
    }
    if (closed) break;

    const reply = await callerReply(personaSys, shared);
    transcript.push({ who: 'caller', text: reply });
    shared.push({ role: 'user', content: reply });
    messages.push({ role: 'user', content: reply });
    if (TRACE) process.stderr.write(`   caller: ${reply}\n`);
  }

  return { tracker, fakes, toolOrder, transcript, closed, goodbye };
}

// ── Scenarios + graders (snapshot-first, transcript only for forbids) ─────────

interface Scenario {
  title: string;
  persona: Persona;
  callerPhone?: string;
  grade: (o: RunOutcome) => string[]; // list of failures; empty = pass
}

const has = (o: RunOutcome, node: string, statuses: NodeStatus[]): string[] =>
  statuses.includes(o.tracker.status(node))
    ? []
    : [`${node} is '${o.tracker.status(node)}' — wanted ${statuses.join('/')}`];
const valueMatch = (o: RunOutcome, node: string, re: RegExp): string[] =>
  re.test(o.tracker.value(node) ?? '')
    ? []
    : [`${node} = '${o.tracker.value(node) ?? '(unset)'}' !~ ${re}`];
const agentSaid = (o: RunOutcome, re: RegExp): boolean =>
  o.transcript.some((t) => t.who === 'agent' && re.test(t.text));
const mustClose = (o: RunOutcome): string[] => (o.closed ? [] : ['call never closed']);
const mustResolve = (o: RunOutcome): string[] =>
  o.tracker.isResolved() ? [] : ['checklist never resolved'];

const SCENARIOS: Scenario[] = [
  {
    // A replay of the 2026-07-20/21 live test calls — the call that broke four ways.
    // Every grader below is a defect Dale reported on a real call:
    //   - only the job tree selected, no meeting ever offered (call 2)
    //   - intake questions before the meeting was booked ("you just blew right
    //     past that", call 3) → get_available_slots must fire before capture
    //   - dictated number never read back (calls 3 AND 4)
    //   - "what would you like to discuss?" after the opener named the topic (call 4)
    //   - caller's name never used between hello and goodbye (call 5 report)
    title: "DALE'S CALL — meeting about a job: book FIRST, read back, use the name",
    persona: {
      opener: "Hi, I'd like to set up a meeting with Dale to talk about a job opportunity.",
      facts: `Your name: Marcus Webb. Your callback number: 262-497-9039 — give it naturally
("262 497 9039"), and confirm when it is read back correctly.
Your company: Bell Labs — you are hiring for your OWN company.
The role: full-time senior software engineer, 120 to 150 thousand salary, fully remote,
team on Central time. You WANT the meeting — accept the first offered time.`,
      behaviour:
        'Friendly and direct. Answer one thing at a time. If asked what you want to ' +
        'discuss, point out you already said — a job opportunity.',
    },
    grade: (o) => {
      const slotsAt = o.toolOrder.indexOf('get_available_slots');
      const captureAt = o.toolOrder.indexOf('capture_job_inquiry');
      return [
        ...has(o, 'book', ['done']),
        ...has(o, 'capture', ['done']),
        ...(slotsAt >= 0 && captureAt >= 0 && slotsAt < captureAt
          ? []
          : [
              `booking must come BEFORE intake — toolOrder: ${o.toolOrder.join(' → ') || '(none)'}`,
            ]),
        // EXACTLY once — zero is the unconfirmed-number bug (calls 3+4), two is
        // the double read-back the unconditional host directive caused (call 7).
        ...(() => {
          const readbacks = o.transcript.filter(
            (t) => t.who === 'agent' && /2\s*6\s*2\D{0,3}4\s*9\s*7\D{0,3}9\s*0\s*3\s*9/.test(t.text)
          ).length;
          return readbacks === 1
            ? []
            : [`dictated number read back ${readbacks} times — must be exactly once`];
        })(),
        ...(agentSaid(o, /\bMarcus\b/)
          ? []
          : ["the caller's name was never used in conversation"]),
        ...(agentSaid(o, /what would you like to (discuss|talk about)/i)
          ? ['asked for the topic the opener already gave']
          : []),
        ...valueMatch(o, 'callers_company', /bell/i),
        ...valueMatch(o, 'hiring_for', /own_company/),
        ...valueMatch(o, 'employment_type', /full_time/),
        ...valueMatch(o, 'work_mode', /remote/),
        ...has(o, 'caller_phone', ['answered']),
        ...mustResolve(o),
        ...mustClose(o),
      ];
    },
  },
  {
    title: 'JOB-DIRECT — recruiter placing with a client, asked step by step',
    persona: {
      opener: "I'd like to talk to someone about a job opportunity for Dale.",
      facts: `Your name: Mike Reilly. Your number: 262-497-9039.
Your company (who YOU work for): Apex Staffing.
You are placing the role WITH A CLIENT: Northern Trust.
It is a CONTRACT role, senior Java developer, 65 to 82 dollars an hour, six months.
Fully remote; the team is on Central time. You do NOT want a meeting — just pass it along.`,
      behaviour: 'Cooperative but brief; answer what is asked, one thing at a time.',
    },
    grade: (o) => [
      ...has(o, 'capture', ['done']),
      ...valueMatch(o, 'callers_company', /apex/i),
      ...valueMatch(o, 'client_company', /northern/i),
      ...valueMatch(o, 'hiring_for', /placing_with_client/),
      ...valueMatch(o, 'work_mode', /remote/),
      ...has(o, 'team_timezone', ['answered']),
      ...has(o, 'salary_range', ['not_applicable']),
      ...mustResolve(o),
      ...mustClose(o),
    ],
  },
  {
    title: 'ONE-BREATH — everything volunteered in the opener, nothing re-asked',
    persona: {
      opener:
        "Hi, this is Sarah Kim from TalentBridge, 262-497-9039 — we've got a full-time " +
        'senior QA role at our own company, paying 120 to 140 thousand, hybrid out of our ' +
        'Milwaukee office at 400 Water Street. Can you pass that to Dale?',
      facts: `Everything is in your opener. Your name: Sarah Kim. Number: 262-497-9039.
Company: TalentBridge (hiring for your OWN company). Full time, 120-140k, hybrid,
office at 400 Water Street, Milwaukee.`,
      behaviour:
        'You already said everything — if asked for something you already said, repeat it ' +
        'with mild impatience ("like I said, …").',
    },
    grade: (o) => [
      ...has(o, 'capture', ['done']),
      ...valueMatch(o, 'callers_company', /talentbridge/i),
      ...valueMatch(o, 'hiring_for', /own_company/),
      ...valueMatch(o, 'employment_type', /full_time/),
      ...has(o, 'salary_range', ['answered']),
      ...has(o, 'position_address', ['answered']),
      ...(agentSaid(o, /(can i (get|have)|what(’|')?s) your name/i)
        ? ['agent asked for a name that was volunteered in the opener']
        : []),
      ...mustResolve(o),
      ...mustClose(o),
    ],
  },
  {
    title: 'WEDDING MESSAGE — a topic with no tree lands in message + generic subject',
    persona: {
      opener: "I'd like to leave a message for Dale about a wedding.",
      facts: `Your name: Grace Okafor. Number: 262-497-9039.
The message: you are getting married September 12th and want to know if Dale's band —
he plays in one — is available to play the reception. You want him to call you back.`,
      behaviour: 'Warm and chatty; happy to give details when asked.',
    },
    grade: (o) => [
      ...(o.tracker.selectedTrees().includes('message') ? [] : ['message tree never selected']),
      ...has(o, 'take_message_action', ['done']),
      ...has(o, 'caller_name', ['answered']),
      ...mustResolve(o),
      ...mustClose(o),
    ],
  },
  {
    title: 'MIND-CHANGE — contract becomes full time mid-call; no ghost data',
    persona: {
      opener: 'I have a position I want to run past Dale.',
      facts: `Your name: Tom Barrett. Number: 262-497-9039. Company: Barrett Recruiting,
hiring for your OWN company. You FIRST say it is a contract role at 70 an hour — but a
moment later (after they ask anything else about it) you CORRECT yourself: actually it was
approved as FULL TIME salaried at 130 thousand. On-site at 800 Main Street, Chicago.
The role: DevOps engineer.`,
      behaviour:
        'Slightly scattered. You get the contract/full-time detail wrong at first and ' +
        'correct yourself unprompted a turn or two later ("wait, sorry — that one is…").',
    },
    grade: (o) => [
      ...has(o, 'capture', ['done']),
      ...valueMatch(o, 'employment_type', /full_time/),
      ...has(o, 'salary_range', ['answered']),
      ...has(o, 'rate_range', ['not_applicable']), // the withdrawn branch left no ghost
      ...mustResolve(o),
      ...mustClose(o),
    ],
  },
  {
    title: 'QA-ONLY — questions answered from RAG, no identity shakedown',
    persona: {
      opener: "I'm curious what kind of experience Dale has — can you tell me about him?",
      facts: `You have no other business. You want to hear about Dale's background, maybe
one follow-up question about what kind of work he does, then you're done. You will NOT
give your name or number — if asked, say you're just curious.`,
      behaviour: 'Curious, casual. Two questions max, then wrap up.',
    },
    grade: (o) => [
      ...(o.fakes.get_company_policy_answer.calls.length >= 1
        ? []
        : ['answer_question never hit the knowledge base']),
      ...(agentSaid(o, /25 years/i) ? [] : ['the KB fact (25 years) never reached the caller']),
      ...(agentSaid(o, /(can i (get|have)|what(’|')?s) your name/i)
        ? ['questions-only caller was asked for a name']
        : []),
      ...mustClose(o),
    ],
  },
  {
    title: 'CALLER-ID BOOKING — attested number never asked for, repair intake + booking',
    persona: {
      opener: "My laptop won't boot after an update — can someone take a look at it?",
      facts: `Your name: Pat Nguyen. You are calling from your own phone (they may already
have the number — do NOT recite it unless asked). Dropping the laptop off is fine if
they say that's how it works; Tuesday afternoon works. Any offered Tuesday time is
fine — take the first one. Your data is backed up to OneDrive, nothing irreplaceable
on the machine.`,
      behaviour: 'Easygoing; picks the first offered time.',
    },
    callerPhone: '2624979039',
    grade: (o) => [
      ...has(o, 'book', ['done']),
      ...has(o, 'caller_phone', ['answered']),
      ...has(o, 'issue_description', ['answered']),
      ...has(o, 'drop_off_ok', ['answered']),
      // STATED, not asked (Dale): the agent must say drop-off is how it works —
      // never pose it as a choice of service modes.
      ...(agentSaid(o, /drop[- ]?off/i) ? [] : ['drop-off policy was never stated to the caller']),
      ...has(o, 'data_backup', ['answered']),
      ...(agentSaid(o, /best (number|phone)|number to reach/i)
        ? ['agent asked for a number it already had from caller ID']
        : []),
      ...mustResolve(o),
      ...mustClose(o),
    ],
  },
  {
    title: "THE ELSE — a need no tree covers still ends in a saved message, never a dead end",
    persona: {
      opener:
        "This is an odd one — my nephew's getting married and I want to know if Dale " +
        'would MC the reception. Is that something he does?',
      facts: `Your name: Rosa Delgado. Number: 262-497-9039.
You know this is unusual. If they can't answer, you'd like Dale to call you back about
it — leave whatever message gets him to call. The date is October 3rd.`,
      behaviour: 'Good-humored about the odd request; happy to leave a message.',
    },
    grade: (o) => [
      ...(o.tracker.selectedTrees().includes('message') ? [] : ['message tree never selected']),
      ...has(o, 'take_message_action', ['done']),
      ...has(o, 'caller_name', ['answered']),
      ...(agentSaid(o, /can'?t help (you )?with that/i)
        ? ['said "can\'t help with that" — the ELSE forbids a dead end']
        : []),
      ...mustResolve(o),
      ...mustClose(o),
    ],
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const picked = SCENARIOS.filter(
    (s) => !CASE_FILTER || s.title.toLowerCase().includes(CASE_FILTER.toLowerCase())
  );
  console.log(
    `${C.b}sim-questiontree${C.x} — ${picked.length} scenario(s) × ${RUNS} run(s), agent=${AGENT_MODEL}, caller=${CALLER_MODEL}\n`
  );
  let pass = 0;
  let fail = 0;
  for (const s of picked) {
    for (let run = 1; run <= RUNS; run++) {
      const label = RUNS > 1 ? `${s.title} [run ${run}]` : s.title;
      process.stdout.write(`${C.y}▶${C.x} ${label}\n`);
      try {
        const outcome = await runCall(s.persona, s.callerPhone);
        const failures = s.grade(outcome);
        if (failures.length === 0) {
          pass++;
          console.log(`${C.g}  ✓ PASS${C.x}  (${outcome.transcript.length} lines)`);
        } else {
          fail++;
          console.log(`${C.r}  ✗ FAIL${C.x}`);
          for (const f of failures) console.log(`${C.r}    - ${f}${C.x}`);
          console.log(`${C.d}    snapshot: ${JSON.stringify(outcome.tracker.snapshot())}${C.x}`);
          for (const t of outcome.transcript.slice(-14))
            console.log(`${C.d}    ${t.who}: ${t.text}${C.x}`);
        }
      } catch (err) {
        fail++;
        console.log(`${C.r}  ✗ ERROR ${String(err)}${C.x}`);
      }
    }
  }
  console.log(`\n${C.b}RESULT: ${pass}/${pass + fail} passed${C.x}`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
