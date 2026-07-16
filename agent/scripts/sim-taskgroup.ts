/**
 * TASK-GROUP END-TO-END — with a LIVE LLM CALLER, so it is bulletproof to phrasing.
 *
 * The point Dale made: real callers word things differently, pause differently, front-load
 * or withhold, give half a number and correct it, answer a question you didn't ask. Scripted
 * turns test ONE phrasing — your own. So this harness does NOT script the caller. A second
 * LLM PLAYS the caller: given a persona (the facts it holds + a behavioural style), it
 * responds naturally to whatever the agent says, and DIFFERENTLY every run.
 *
 * It runs the REAL tasks (planCallTasks → Identity → Book → JobIntake) with their real
 * instructions and real tools, against the real backend + real DB. The only thing not real
 * is the caller's voice — it's an LLM instead of a phone. Each scenario runs across several
 * STYLES (terse, chatty, front-loader, self-corrector, …) to shake out phrasing bugs, and
 * every run is verified against the DATABASE, not the transcript.
 *
 * Run:  cd agent && BACKEND_URL=https://localhost:4001 npx tsx scripts/sim-taskgroup.ts
 *   env: OPENAI_API_KEY, AGENT_SECRET, DATABASE_URL, a backend, a bookable tenant.
 *   SIM_CASE=<substr>   run only matching scenarios
 *   SIM_STYLES=terse,chatty   limit which styles run (default: all)
 *   SIM_RUNS=1          runs per (scenario × style) (default 1)
 */
import { llm, initializeLogger } from '@livekit/agents';
import { Client } from 'pg';
import { ToolsClient } from '../src/toolsClient.js';
import { buildTools } from '../src/tools.js';
import { planCallTasks, type CallDeps } from '../src/tasks/callPlan.js';
import type { SessionContext } from '../src/sessionContext.js';

const API_KEY = process.env.OPENAI_API_KEY;
const AGENT_MODEL = process.env.SIM_TASKGROUP_MODEL || 'gpt-4o-mini';
const CALLER_MODEL = process.env.SIM_CALLER_MODEL || 'gpt-4o-mini';
const BACKEND_URL = process.env.BACKEND_URL || 'https://localhost:4001';
const AGENT_SECRET = process.env.AGENT_SECRET || '';
const DB_URL = process.env.DATABASE_URL || '';
const TENANT = process.env.SIM_TENANT || 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0';
const CASE_FILTER = process.env.SIM_CASE || '';
const RUNS = Number(process.env.SIM_RUNS || 1);

const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', d: '', b: '', x: '' };

if (!API_KEY) throw new Error('OPENAI_API_KEY not set');
if (!AGENT_SECRET) throw new Error('AGENT_SECRET not set');
if (BACKEND_URL.startsWith('https://localhost')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
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
      throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    await sleep(Math.min(1500 * 2 ** (attempt - 1), 15_000));
  }
  throw new Error('OpenAI unreachable after retries');
}

function toolSchemas(ctx: llm.ToolContext): { type: 'function'; function: unknown }[] {
  return Object.entries(ctx).map(([name, t]) => {
    const shape = t as unknown as { description: string; parameters: Record<string, unknown> };
    return {
      type: 'function' as const,
      function: { name, description: shape.description, parameters: shape.parameters },
    };
  });
}

// ── THE CALLER ────────────────────────────────────────────────────────────────
// A persona = the facts the caller holds + a behavioural style. The caller LLM sees the
// running transcript and produces the next spoken line — naturally, and differently each run.

interface Persona {
  name: string;
  phone: string; // canonical; the caller states THIS number, phrased however
  goalLine: string; // how they open ("I'd like a meeting with Dale about a job")
  wantsMeeting: boolean;
  hasJobInquiry: boolean;
  requestedService: string;
  // job facts (used only if hasJobInquiry)
  callerCompany?: string;
  clientCompany?: string;
  inHouse?: boolean; // hiring for own company → client == caller
  employmentType?: 'contract' | 'full_time';
  rate?: string;
  length?: string;
  location?: 'onsite' | 'remote' | 'hybrid';
  address?: string;
  timezone?: string;
  // schedule-change (cancel / reschedule an EXISTING appointment)
  wantsScheduleChange?: boolean;
  scheduleAction?: 'cancel' | 'reschedule';
  existingService?: string; // what the seeded appointment is, so the caller can name it
  // hard behaviours the persona MUST exhibit (adversarial)
  refusesPhone?: boolean; // never gives a number
}

const STYLES: Record<string, string> = {
  plain: 'Answer naturally and directly, one short spoken sentence at a time.',
  terse: 'Answer in as few words as possible — often one or two words. Do not elaborate.',
  chatty:
    'Be warm and a bit chatty. Sometimes volunteer extra detail before being asked, and add small asides. Still get to the point.',
  frontloader:
    'In your VERY FIRST reply, cram in as much as you can at once — your name, number, and what you want, all in one breath. After that, answer what is asked.',
  corrector:
    'When you give your phone number the first time, say it slightly wrong or incompletely; then when they read it back or ask, correct it to the right one.',
  rambler:
    'Ramble a little — start answering, go off on a short tangent, then come back to the point. Never refuse to answer, just take a scenic route.',
};

function personaSystem(p: Persona, style: string): string {
  const facts = [
    `Your name: ${p.name}`,
    p.refusesPhone
      ? `You will NOT give your phone number, no matter how many times asked. Politely decline every time.`
      : `Your phone number: ${p.phone} (give THIS exact number when asked; you may phrase the digits naturally, but the number itself is always ${p.phone}).`,
    `Why you called: ${p.goalLine}`,
  ];
  if (p.wantsScheduleChange) {
    facts.push(
      `You ALREADY have an appointment booked — a ${p.existingService ?? 'meeting'}. You are calling to ${p.scheduleAction === 'cancel' ? 'CANCEL that appointment' : 'RESCHEDULE (move) that appointment to a different time'}.`
    );
    if (p.scheduleAction === 'reschedule') {
      facts.push(
        `When the receptionist reads back your current appointment, confirm it is the one. When they offer available new times, pick ONE of the offered times and say it clearly.`
      );
    } else {
      facts.push(
        `When the receptionist reads back your current appointment and asks you to confirm you want it canceled, say yes.`
      );
    }
  }
  if (p.hasJobInquiry) {
    facts.push(`The company you work for: ${p.callerCompany}`);
    if (p.inHouse) {
      facts.push(
        `You are hiring for YOUR OWN company (${p.callerCompany}) — if asked whether you're hiring for your own company or placing with a client, say your OWN company. There is no separate client.`
      );
    } else {
      facts.push(
        `You are placing someone with a CLIENT: ${p.clientCompany}. If asked whether it's your own company or a client, say a client, and name ${p.clientCompany}.`
      );
    }
    facts.push(`Employment type: ${p.employmentType === 'full_time' ? 'full time' : 'contract'}`);
    if (p.rate) facts.push(`Pay/rate: ${p.rate}`);
    if (p.length) facts.push(`Contract length: ${p.length}`);
    if (p.location) facts.push(`Location: ${p.location}`);
    if (p.address) facts.push(`Address of the position: ${p.address}`);
    if (p.timezone) facts.push(`Timezone: ${p.timezone}`);
  }
  return `You are a person calling a small business's phone receptionist. You are the CALLER, not the assistant. Speak like a real person on the phone — short spoken turns, no lists, no markdown.

STYLE: ${STYLES[style]}

FACTS ABOUT YOU (answer truthfully from these, but only when relevant/asked):
${facts.map((f) => '- ' + f).join('\n')}

RULES:
- Reply with ONLY your spoken words for your next turn. No stage directions, no quotes.
- Answer the question you were actually asked. Give facts as they come up; do not dump everything unless your STYLE says to.
- If they ask something you already answered, you may say so briefly, then answer again.
- When the receptionist has clearly finished helping you (confirmed your booking and/or said they've passed your details along, and asks if there's anything else), say you're all set / no thanks — do not invent new requests.
- Never say you are an AI. Never narrate. Just talk.`;
}

async function callerReply(personaSys: string, shared: ChatMessage[]): Promise<string> {
  // The caller sees the call from ITS side: the agent's lines (role 'assistant' in the
  // shared history) are what the caller HEARD → 'user' to the caller model; the caller's
  // own prior lines (role 'user' in shared) are its own past turns → 'assistant'.
  const view: ChatMessage[] = [{ role: 'system', content: personaSys }];
  for (const m of shared) {
    if (m.role === 'assistant' && m.content) view.push({ role: 'user', content: m.content });
    else if (m.role === 'user' && m.content) view.push({ role: 'assistant', content: m.content });
  }
  const { content } = await openai(CALLER_MODEL, 0.9, view);
  return (content ?? 'Okay.').trim();
}

// ── DRIVER: run the whole call with a live caller ──────────────────────────────

interface RunResult {
  rungsCompleted: string[];
  rungsAttempted: string[];
  transcript: { who: 'agent' | 'caller'; text: string }[];
}

async function runCall(p: Persona, style: string, deps: CallDeps): Promise<RunResult> {
  const personaSys = personaSystem(p, style);
  const specs = planCallTasks(p, deps);
  const result: RunResult = { rungsCompleted: [], rungsAttempted: [], transcript: [] };

  // Shared conversation carried across rungs (mirrors TaskGroup's merged chatCtx, minus the
  // per-rung system prompt). The caller has continuous memory of the whole call.
  const shared: ChatMessage[] = [];

  // The caller opens the call.
  const opener = await callerReply(personaSys, [{ role: 'assistant', content: 'Thanks for calling. How can I help you today?' }]);
  result.transcript.push({ who: 'agent', text: 'How can I help you today?' });
  result.transcript.push({ who: 'caller', text: opener });
  shared.push({ role: 'user', content: opener });

  let totalTurns = 0;
  for (const spec of specs) {
    result.rungsAttempted.push(spec.id);
    const task = spec.factory() as unknown as {
      instructions: string;
      toolCtx: llm.ToolContext;
      done: boolean;
    };
    const schemas = toolSchemas(task.toolCtx);
    const messages: ChatMessage[] = [{ role: 'system', content: task.instructions }, ...shared];

    for (let round = 0; round < 16 && !task.done && totalTurns < 60; round++) {
      totalTurns++;
      const { content, toolCalls } = await openai(AGENT_MODEL, 0, messages, schemas);

      if (toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: content ?? null, tool_calls: toolCalls });
        if (content) {
          result.transcript.push({ who: 'agent', text: content });
          shared.push({ role: 'assistant', content });
        }
        for (const tc of toolCalls) {
          const tool = task.toolCtx[tc.function.name] as
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
            res = await tool.execute(args, { ctx: {}, toolCallId: tc.id });
          }
          const rs = typeof res === 'string' ? res : JSON.stringify(res);
          if (process.env.SIM_TRACE)
            process.stderr.write(
              `      [tool] ${tc.function.name}(${(tc.function.arguments || '').slice(0, 120)}) -> ${rs.slice(0, 200)}\n`
            );
          messages.push({ role: 'tool', tool_call_id: tc.id, content: rs });
        }
        continue;
      }

      // Plain agent reply → speak it, then let the caller respond.
      const agentLine = content ?? '';
      messages.push({ role: 'assistant', content: agentLine });
      if (agentLine.trim()) {
        result.transcript.push({ who: 'agent', text: agentLine });
        shared.push({ role: 'assistant', content: agentLine });
      }
      if (task.done) break;

      const reply = await callerReply(personaSys, shared);
      result.transcript.push({ who: 'caller', text: reply });
      shared.push({ role: 'user', content: reply });
      messages.push({ role: 'user', content: reply });
    }

    if (task.done) result.rungsCompleted.push(spec.id);
    else break; // a rung that never completed blocks the ones after it (as the real loop would)
  }
  return result;
}

// ── SCENARIOS (persona + expectations) ─────────────────────────────────────────

interface Expect {
  appointment: boolean;
  jobInquiry: boolean;
  clientCompany?: string;
  representsCompany?: boolean;
  // schedule-change outcomes, checked against the seeded appointment
  canceled?: boolean;
  rescheduled?: boolean;
}
/** What a seed step handed back — the appointment the scenario will act on. */
interface SeedInfo {
  appointmentId: string;
  startTime: string;
}
interface Scenario {
  title: string;
  persona: Persona;
  expect: Expect;
  styles?: string[]; // default: a spread
  /** Insert the state the scenario acts on (e.g. an existing appointment to cancel). Runs
   *  AFTER the per-run cleanup, so each run acts on a fresh row. */
  seed?: (db: Client, p: Persona) => Promise<SeedInfo>;
}

const SEED_SERVICE_NAME = 'Programming Consultation';

/** POST to a backend agent-tool the way the agent would (x-agent-secret). */
async function postAgent(path: string, body: Record<string, unknown>): Promise<{
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-secret': AGENT_SECRET },
    body: JSON.stringify(body),
  });
  return (await res.json()) as { success: boolean; result?: Record<string, unknown>; error?: string };
}

/** "1:00 PM" / "4:30 PM" → local-naive 24h "13:00:00" / "16:30:00" for a booking window. */
function to24h(spoken: string): string {
  const m = spoken.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return '13:00:00';
  let h = Number(m[1]);
  const min = m[2];
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}:00`;
}

/**
 * Seed the appointment a cancel/reschedule call will act on — by BOOKING A REAL MEETING
 * through the production path (book_with_scheduling), NOT a raw INSERT. This is the point
 * Dale made: the thing you cancel has to be a real appointment, created the way a real one
 * is — so it carries a real service_id, an assigned employee, shift coverage, the lot. A
 * raw INSERT reproduced the NULL-service "blank calendar" bug; booking cannot.
 *
 * Books the earliest open slot in tomorrow's business window, then reads the row back for
 * the actual start_time (so the reschedule check can prove the time moved).
 */
async function seedAppointment(db: Client, p: Persona): Promise<SeedInfo> {
  // Find a REAL open slot first, then book that exact time — mirroring how the live agent
  // books (get_available_slots → book a targeted window). Passing a wide window and hoping
  // the RPC scans forward does NOT work: with the earliest slot occupied it collides rather
  // than advancing (the RPC expects a targeted window_from, which the model always gives it
  // after get_available_slots). So scan days for the first one with an open time.
  const zone = 'America/Chicago';
  let picked: { date: string; from: string } | null = null;
  for (let d = 1; d <= 8 && !picked; d++) {
    const date = new Date(Date.now() + d * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', {
      timeZone: zone,
    });
    const slots = await postAgent('/agent-tools/available-slots', {
      tenant_id: TENANT,
      service_type: SEED_SERVICE_NAME,
      date,
    });
    const open = (slots.result?.open_times as string[] | undefined) ?? [];
    if (open.length > 0) picked = { date, from: `${date}T${to24h(open[0])}` };
  }
  if (!picked) throw new Error('seed: no open slot found in the next 8 days');
  const booked = await postAgent('/agent-tools/book-with-scheduling', {
    tenant_id: TENANT,
    phone: p.phone,
    name: p.name,
    description: 'Booking via SecretaryHQ',
    call_id: `sim-seed-${p.phone}`,
    requirements: { serviceType: SEED_SERVICE_NAME },
    // Narrow window AT the open slot — book exactly that time.
    window: { from: picked.from, to: `${picked.date}T17:00:00` },
  });
  if (!booked.success || !booked.result?.appointment_id) {
    throw new Error(`seed booking failed: ${booked.error ?? JSON.stringify(booked.result)}`);
  }
  const appointmentId = String(booked.result.appointment_id);
  const row = await db.query<{ start_time: string }>(
    `SELECT start_time FROM appointments WHERE appointment_id = $1`,
    [appointmentId]
  );
  return { appointmentId, startTime: row.rows[0]?.start_time };
}

const DEFAULT_STYLES = ['plain', 'terse', 'chatty', 'frontloader', 'corrector', 'rambler'];

const SCENARIOS: Scenario[] = [
  {
    title: 'meeting + job (the two-goal baseline)',
    persona: {
      name: 'Priya Nowak',
      phone: '555-901-0001',
      goalLine: 'you want a meeting with Dale to talk about a contract role',
      wantsMeeting: true,
      hasJobInquiry: true,
      requestedService: 'a meeting about a contract role',
      callerCompany: 'Insight Global',
      clientCompany: 'Blue Cross',
      employmentType: 'contract',
      rate: '$70 to $80 an hour',
      length: 'twelve months',
      location: 'hybrid',
      address: '200 East Randolph, Chicago',
    },
    expect: { appointment: true, jobInquiry: true, clientCompany: 'Blue Cross', representsCompany: false },
  },
  {
    title: 'meeting only — must NOT fabricate a job inquiry',
    persona: {
      name: 'Grace Okoro',
      phone: '555-901-0002',
      goalLine: 'you just want to book a meeting with Dale (no job talk)',
      wantsMeeting: true,
      hasJobInquiry: false,
      requestedService: 'a meeting with Dale',
    },
    expect: { appointment: true, jobInquiry: false },
    styles: ['plain', 'terse', 'frontloader'],
  },
  {
    title: 'job only — records it, does NOT book a meeting',
    persona: {
      name: 'Sam Devlin',
      phone: '555-901-0003',
      goalLine: 'you just want to pass a role to Dale, no meeting needed',
      wantsMeeting: false,
      hasJobInquiry: true,
      requestedService: 'passing a role to Dale',
      callerCompany: 'TEKsystems',
      clientCompany: 'Northern Trust',
      employmentType: 'full_time',
      rate: '$150k to $180k',
      location: 'onsite',
      address: '10 South Wacker, Chicago',
    },
    expect: { appointment: false, jobInquiry: true, clientCompany: 'Northern Trust', representsCompany: false },
    styles: ['plain', 'chatty', 'rambler'],
  },
  {
    title: 'in-house recruiter — must NOT double-ask the company',
    persona: {
      name: 'Dana Feld',
      phone: '555-901-0004',
      goalLine: 'you have a role at your own company and want to reach Dale',
      wantsMeeting: false,
      hasJobInquiry: true,
      requestedService: 'a role at our company',
      callerCompany: 'Globex',
      inHouse: true,
      employmentType: 'contract',
      rate: '$90 an hour',
      length: 'six months',
      location: 'remote',
      timezone: 'Central',
    },
    expect: { appointment: false, jobInquiry: true, clientCompany: 'Globex', representsCompany: true },
    styles: ['plain', 'terse'],
  },
  {
    title: 'cancel an existing appointment',
    persona: {
      name: 'Owen Pratt',
      phone: '555-901-0007',
      goalLine: 'you want to cancel an appointment you already have',
      wantsMeeting: false,
      hasJobInquiry: false,
      wantsScheduleChange: true,
      scheduleAction: 'cancel',
      existingService: 'Programming Consultation',
      requestedService: 'canceling my appointment',
    },
    expect: { appointment: false, jobInquiry: false, canceled: true },
    seed: seedAppointment,
    styles: ['plain', 'chatty'],
  },
  {
    title: 'reschedule an existing appointment',
    persona: {
      name: 'Mara Quinn',
      phone: '555-901-0008',
      goalLine: 'you want to move an appointment you already have to a different time',
      wantsMeeting: false,
      hasJobInquiry: false,
      wantsScheduleChange: true,
      scheduleAction: 'reschedule',
      existingService: 'Programming Consultation',
      requestedService: 'moving my appointment',
    },
    expect: { appointment: false, jobInquiry: false, rescheduled: true },
    seed: seedAppointment,
    styles: ['plain', 'terse'],
  },
  {
    title: 'STRESS: caller refuses to give a phone number',
    persona: {
      name: 'Robin Vance',
      phone: '555-901-0006',
      goalLine: 'you want a meeting but will not share a phone number',
      wantsMeeting: true,
      hasJobInquiry: false,
      requestedService: 'a meeting',
      refusesPhone: true,
    },
    // No number → identity can't complete → no booking. Documents the limit.
    expect: { appointment: false, jobInquiry: false },
    styles: ['plain'],
  },
];

async function verify(db: Client, p: Persona, e: Expect, seed?: SeedInfo): Promise<string[]> {
  const fails: string[] = [];
  const e164 = '+1' + p.phone.replace(/\D/g, '');

  // Schedule-change scenarios act on the SEEDED appointment (by id), so check that row
  // directly and skip the generic "was a new appointment booked?" checks below.
  const isScheduleChange = Boolean(e.canceled || e.rescheduled);
  if (isScheduleChange && seed) {
    // The seeded appointment must carry a real service_id — a NULL service is the
    // "blank on the owner's calendar" bug; test data must not reproduce it.
    const r = await db.query<{ service_id: string | null }>(
      `SELECT service_id FROM appointments WHERE appointment_id = $1`,
      [seed.appointmentId]
    );
    if (r.rows[0] && !r.rows[0].service_id)
      fails.push('seeded appointment has a NULL service_id (should be a real service)');
  }
  if (e.canceled) {
    const r = await db.query<{ status: string }>(
      `SELECT status FROM appointments WHERE appointment_id = $1`,
      [seed?.appointmentId]
    );
    const status = r.rows[0]?.status;
    if (status !== 'canceled') fails.push(`expected appointment CANCELED, status is "${status}"`);
  }
  if (e.rescheduled) {
    const r = await db.query<{ status: string; start_time: string }>(
      `SELECT status, start_time FROM appointments WHERE appointment_id = $1`,
      [seed?.appointmentId]
    );
    const row = r.rows[0];
    if (!row) fails.push('rescheduled appointment vanished');
    else if (row.status !== 'scheduled')
      fails.push(`expected RESCHEDULED (still scheduled), status is "${row.status}"`);
    else if (String(row.start_time) === String(seed?.startTime))
      fails.push('expected RESCHEDULED to a new time, but start_time is unchanged');
  }

  if (!isScheduleChange) {
    const appt = await db.query<{ service: string | null }>(
      `SELECT s.name AS service FROM appointments a
         LEFT JOIN services s USING (service_id)
         JOIN customers c USING (customer_id)
        WHERE a.tenant_id = $1 AND c.phone = $2 ORDER BY a.created_at DESC LIMIT 1`,
      [TENANT, e164]
    );
    if (e.appointment && !appt.rows[0]) fails.push('expected APPOINTMENT, none found');
    if (!e.appointment && appt.rows[0]) fails.push('APPOINTMENT booked but none expected');
    if (e.appointment && appt.rows[0] && !appt.rows[0].service)
      fails.push('appointment service is NULL');
  }

  const job = await db.query<{ client_company: string | null; represents_company: boolean | null }>(
    `SELECT client_company, represents_company FROM job_inquiries
      WHERE tenant_id = $1 AND callback_phone = $2 ORDER BY created_at DESC LIMIT 1`,
    [TENANT, e164]
  );
  if (e.jobInquiry && !job.rows[0]) fails.push('expected JOB INQUIRY, none found');
  if (!e.jobInquiry && job.rows[0]) fails.push('JOB INQUIRY recorded but none expected');
  if (e.clientCompany && job.rows[0] && job.rows[0].client_company !== e.clientCompany)
    fails.push(`client_company="${job.rows[0].client_company}", expected "${e.clientCompany}"`);
  if (e.representsCompany !== undefined && job.rows[0] && job.rows[0].represents_company !== e.representsCompany)
    fails.push(`represents_company=${job.rows[0].represents_company}, expected ${e.representsCompany}`);

  return fails;
}

function makeDeps(): CallDeps {
  const ctx: SessionContext = {
    tenantId: TENANT,
    callerPhone: null,
    callId: `sim-tg-${Date.now()}-${Math.floor(performance.now())}`,
    roomName: 'sim-tg',
    participantIdentity: 'sim',
  };
  const client = new ToolsClient({ backendUrl: BACKEND_URL, agentSecret: AGENT_SECRET });
  const tools = buildTools(ctx, client);
  const now = new Date();
  const currentDate = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago',
  });
  return {
    ctx,
    state: {},
    runtime: { currentDate, timezone: 'America/Chicago', businessHours: 'Monday to Friday, 1:00 PM to 5:00 PM', bookableThrough: null },
    tools,
  };
}

async function main(): Promise<void> {
  initializeLogger({ pretty: false, level: 'silent' });
  const stylesEnv = (process.env.SIM_STYLES || '').split(',').map((s) => s.trim()).filter(Boolean);

  const chosen = SCENARIOS.filter((s) => !CASE_FILTER || s.title.toLowerCase().includes(CASE_FILTER.toLowerCase()));
  console.log(`${C.b}Task-group E2E — live LLM caller${C.x} ${C.d}(agent ${AGENT_MODEL}, caller ${CALLER_MODEL})${C.x}`);

  const db = DB_URL ? new Client({ connectionString: DB_URL }) : null;
  if (db) await db.connect();

  let runs = 0;
  let passed = 0;
  const failures: { title: string; style: string; fails: string[]; transcript: RunResult['transcript'] }[] = [];

  try {
    for (const sc of chosen) {
      const styles = (stylesEnv.length ? stylesEnv : sc.styles ?? DEFAULT_STYLES);
      console.log(`\n${C.b}${sc.title}${C.x}`);
      for (const style of styles) {
        for (let r = 0; r < RUNS; r++) {
          // reset this caller's rows so each run is deterministic
          let seedInfo: SeedInfo | undefined;
          if (db) {
            const e164 = '+1' + sc.persona.phone.replace(/\D/g, '');
            await db.query(`DELETE FROM job_inquiries WHERE tenant_id=$1 AND callback_phone=$2`, [TENANT, e164]);
            await db.query(
              `DELETE FROM appointments WHERE tenant_id=$1 AND customer_id IN (SELECT customer_id FROM customers WHERE tenant_id=$1 AND phone=$2)`,
              [TENANT, e164]
            );
            // Seed AFTER the wipe, so the scenario acts on a fresh appointment. A seed
            // failure (e.g. a contended calendar) must NOT crash the whole suite — record it
            // as this run's failure and move on, so one bad seed can't hide 30 good runs.
            if (sc.seed) {
              try {
                seedInfo = await sc.seed(db, sc.persona);
              } catch (err) {
                runs++;
                failures.push({
                  title: sc.title,
                  style,
                  fails: [`SEED FAILED: ${(err as Error).message}`],
                  transcript: [],
                });
                console.log(`  ${style.padEnd(11)} ${C.r}SEED-ERR${C.x} ${(err as Error).message}`);
                continue;
              }
            }
          }
          runs++;
          const deps = makeDeps();
          let res: RunResult;
          try {
            res = await runCall(sc.persona, style, deps);
          } catch (err) {
            failures.push({ title: sc.title, style, fails: [`THREW: ${(err as Error).message}`], transcript: [] });
            console.log(`  ${style.padEnd(11)} ${C.r}ERROR${C.x} ${(err as Error).message}`);
            continue;
          }
          const dbFails = db ? await verify(db, sc.persona, sc.expect, seedInfo) : [];
          const rungInfo = `${res.rungsCompleted.length}/${res.rungsAttempted.length} rungs`;
          if (dbFails.length === 0) {
            passed++;
            console.log(`  ${style.padEnd(11)} ${C.g}PASS${C.x} ${C.d}(${rungInfo})${C.x}`);
          } else {
            failures.push({ title: sc.title, style, fails: dbFails, transcript: res.transcript });
            console.log(`  ${style.padEnd(11)} ${C.r}FAIL${C.x} ${C.d}(${rungInfo})${C.x} — ${dbFails.join('; ')}`);
          }
        }
      }
    }
  } finally {
    if (db) await db.end();
  }

  console.log(`\n${passed === runs ? C.g : C.r}${passed}/${runs} runs passed${C.x}`);

  // Dump transcripts of failures so the cause is visible without re-running.
  if (failures.length) {
    console.log(`\n${C.b}── FAILURE TRANSCRIPTS ──${C.x}`);
    for (const f of failures) {
      console.log(`\n${C.r}✗ ${f.title} [${f.style}]${C.x} — ${f.fails.join('; ')}`);
      for (const t of f.transcript) {
        console.log(`   ${t.who === 'agent' ? C.b + 'AGENT ' : C.d + 'caller'}${C.x} ${t.text}`);
      }
    }
  }

  process.exit(passed === runs ? 0 : 1);
}

main().catch((err) => {
  console.error(`sim-taskgroup: ${(err as Error).stack || err}`);
  process.exit(1);
});
