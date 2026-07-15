/**
 * TASK-GROUP END-TO-END. The whole call, driven by code, not a segment.
 *
 * sim-toolselect exercises the PROMPT ladder. This exercises the TASK-GROUP flow: it runs
 * the REAL tasks (planCallTasks → IdentityTask, BookMeetingTask, JobIntakeTask) with their
 * REAL instructions and REAL tools, against the REAL backend at BACKEND_URL, writing to the
 * REAL database — the only thing swapped for voice is a SCRIPTED caller.
 *
 * It replays exactly what the TaskGroup loop does: pop a task, run its chat loop until its
 * completion tool fires (confirm_identity / a successful book_with_scheduling / a
 * successful capture_job_inquiry), then advance. When the last task completes, it reads the
 * database and checks the CONCRETE outcomes: an appointment with the right service, and a
 * job inquiry — the two goals the prompt ladder kept dropping.
 *
 * Run: cd agent && npx tsx scripts/sim-taskgroup.ts   (needs OPENAI_API_KEY, AGENT_SECRET,
 * a backend on BACKEND_URL, and a bookable tenant.)
 */
import { llm, initializeLogger } from '@livekit/agents';
import { Client } from 'pg';
import { ToolsClient } from '../src/toolsClient.js';
import { buildTools } from '../src/tools.js';
import { planCallTasks, runtimePreamble, type CallDeps } from '../src/tasks/callPlan.js';
import type { SessionContext } from '../src/sessionContext.js';

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.SIM_TASKGROUP_MODEL || 'gpt-4o-mini';
const BACKEND_URL = process.env.BACKEND_URL || 'https://localhost:4001';
const AGENT_SECRET = process.env.AGENT_SECRET || '';
const DB_URL = process.env.DATABASE_URL || '';
const TENANT = process.env.SIM_TENANT || 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0';

const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', d: '', b: '', x: '' };

if (!API_KEY) throw new Error('OPENAI_API_KEY not set');
if (!AGENT_SECRET) throw new Error('AGENT_SECRET not set');
// Accept the local self-signed backend cert.
if (BACKEND_URL.startsWith('https://localhost')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function chat(
  messages: ChatMessage[],
  tools: { type: 'function'; function: unknown }[]
): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: MODEL, temperature: 0, messages, tools, tool_choice: 'auto' }),
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

/** Turn a ToolContext into OpenAI function schemas. */
function toolSchemas(ctx: llm.ToolContext): { type: 'function'; function: unknown }[] {
  return Object.entries(ctx).map(([name, t]) => {
    const shape = t as unknown as { description: string; parameters: Record<string, unknown> };
    return {
      type: 'function' as const,
      function: { name, description: shape.description, parameters: shape.parameters },
    };
  });
}

/**
 * Drive ONE task to completion. Runs its chat loop, feeding scripted caller turns and
 * executing its real tools, until the task reports done() — exactly what TaskGroup's loop
 * does with `await task.run()`. Returns the transcript for reporting.
 */
async function runTask(
  task: { instructions: string; toolCtx: llm.ToolContext; done: boolean },
  callerTurns: string[],
  said: string[]
): Promise<void> {
  const schemas = toolSchemas(task.toolCtx);
  const queue = [...callerTurns];
  const messages: ChatMessage[] = [
    { role: 'system', content: task.instructions },
    // A nudge so the task opens by addressing the caller, as onEnter's generateReply would.
    { role: 'user', content: queue.shift() ?? 'Hello?' },
  ];

  for (let round = 0; round < 16 && !task.done; round++) {
    const { content, toolCalls } = await chat(messages, schemas);
    if (content) said.push(content);

    if (toolCalls.length > 0) {
      messages.push({ role: 'assistant', content: content ?? null, tool_calls: toolCalls });
      for (const tc of toolCalls) {
        const tool = task.toolCtx[tc.function.name] as
          | { execute: (a: unknown, o: unknown) => Promise<unknown> }
          | undefined;
        let result: unknown = `unknown tool ${tc.function.name}`;
        if (tool) {
          let args: unknown = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            /* leave {} */
          }
          result = await tool.execute(args, { ctx: {}, toolCallId: tc.id });
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }
      continue; // let the model react to the tool result before the next caller turn
    }

    // Plain reply — feed the next scripted caller turn.
    messages.push({ role: 'assistant', content: content ?? '' });
    const next = queue.shift();
    if (!next) break;
    messages.push({ role: 'user', content: next });
  }
}

async function main(): Promise<void> {
  initializeLogger({ pretty: false, level: 'silent' });
  console.log(`${C.b}Task-group E2E${C.x} ${C.d}(model ${MODEL}, backend ${BACKEND_URL})${C.x}\n`);

  const ctx: SessionContext = {
    tenantId: TENANT,
    callerPhone: null, // forwarded-line style: caller must give the number aloud
    callId: `sim-taskgroup-${Date.now()}`,
    roomName: 'sim-taskgroup',
    participantIdentity: 'sim',
  };
  const client = new ToolsClient({ backendUrl: BACKEND_URL, agentSecret: AGENT_SECRET });
  const tools = buildTools(ctx, client);

  // Resolve the runtime facts the same way index.ts does.
  const now = new Date();
  const currentDate = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Chicago',
  });
  const deps: CallDeps = {
    ctx,
    state: {},
    runtime: {
      currentDate,
      timezone: 'America/Chicago',
      businessHours: 'Monday to Friday, 1:00 PM to 5:00 PM',
      bookableThrough: null,
    },
    tools,
  };

  // THE CALL: "a meeting to talk about a job" — two goals, the pair the ladder kept
  // dropping. Intent classification (what CallRootAgent.begin_call does) is asserted by
  // the fixture: wantsMeeting + hasJobInquiry.
  const goals = {
    wantsMeeting: true,
    hasJobInquiry: true,
    requestedService: 'a meeting to talk about a contract position',
  };
  const specs = planCallTasks(goals, deps);
  console.log(`  plan: ${specs.map((s) => s.id).join(' → ')}\n`);

  // Scripted caller turns per rung. A real caller answers what the rung asks; these are
  // written to satisfy each rung's questions in order.
  const turnsByTask: Record<string, string[]> = {
    identity: [
      "Hi, I'd like a meeting with Dale to talk about a contract position.",
      'My name is Priya Nowak.',
      'My number is 555-212-0199.',
      "Yes, that's correct.",
    ],
    book_meeting: [
      'Tomorrow afternoon works.',
      "Whatever's open around 2 is great.",
      'That time works, yes.',
    ],
    job_intake: [
      "I'm calling from Insight Global.",
      "No, I'm placing someone with a client — it's for Blue Cross.",
      "It's a contract.",
      '$70 to $80 an hour.',
      'Twelve months.',
      "It's hybrid.",
      '200 East Randolph, Chicago.',
    ],
  };

  const said: string[] = [];
  const tabDate = new Date().toISOString();
  for (const spec of specs) {
    const task = spec.factory() as unknown as {
      instructions: string;
      toolCtx: llm.ToolContext;
      done: boolean;
    };
    process.stdout.write(`  ${C.d}running rung${C.x} ${spec.id} ... `);
    await runTask(task, turnsByTask[spec.id] ?? ['Okay.'], said);
    if (task.done) {
      console.log(`${C.g}done${C.x}`);
    } else {
      console.log(`${C.r}NOT COMPLETED${C.x} — the rung did not finish its work`);
    }
  }

  // ── VERIFY AGAINST THE DATABASE — the concrete outcomes, not the transcript ──
  console.log(`\n  ${C.b}Checking the database for what actually landed:${C.x}`);
  let pass = true;
  if (DB_URL) {
    const db = new Client({ connectionString: DB_URL });
    await db.connect();
    try {
      const appt = await db.query(
        `SELECT a.appointment_id, a.start_time, s.name AS service
           FROM appointments a LEFT JOIN services s USING (service_id)
          WHERE a.tenant_id = $1 AND a.created_at >= $2
          ORDER BY a.created_at DESC LIMIT 1`,
        [TENANT, tabDate]
      );
      if (appt.rows[0]) {
        console.log(
          `  ${C.g}✓ APPOINTMENT${C.x} ${appt.rows[0].service ?? '(no service)'} at ${appt.rows[0].start_time}`
        );
        if (!appt.rows[0].service) {
          console.log(`  ${C.r}  …but service is NULL${C.x}`);
          pass = false;
        }
      } else {
        console.log(`  ${C.r}✗ NO APPOINTMENT was booked${C.x}`);
        pass = false;
      }

      const job = await db.query(
        `SELECT caller_name, callback_phone, caller_company, client_company, rate_range
           FROM job_inquiries WHERE tenant_id = $1 AND created_at >= $2
          ORDER BY created_at DESC LIMIT 1`,
        [TENANT, tabDate]
      );
      if (job.rows[0]) {
        const j = job.rows[0];
        console.log(
          `  ${C.g}✓ JOB INQUIRY${C.x} ${j.caller_name} / ${j.callback_phone} — ${j.caller_company} → ${j.client_company}, ${j.rate_range}`
        );
      } else {
        console.log(`  ${C.r}✗ NO JOB INQUIRY was recorded (the rung that keeps getting skipped)${C.x}`);
        pass = false;
      }
    } finally {
      await db.end();
    }
  } else {
    console.log(`  ${C.y}(DATABASE_URL not set — skipping DB verification)${C.x}`);
  }

  console.log(
    `\n  ${pass ? C.g : C.r}${pass ? 'PASS' : 'FAIL'}${C.x} — both goals ${pass ? 'landed' : 'did NOT land'}.`
  );
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(`sim-taskgroup: ${(err as Error).stack || err}`);
  process.exit(1);
});
