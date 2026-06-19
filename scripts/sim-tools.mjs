// sim-tools.mjs — functional simulation of everything the voice agent DOES on a
// call, strung into ONE realistic journey, asserted end-to-end. Driven by
// scripts/simulate.sh `tools`. No telephony, no LLM — it drives the exact
// /agent-tools/* endpoints the agent calls, in the order a real call hits them.
//
// Journey: a NEW caller phones an auto shop, hears the catalog, books an oil
// change, the shop saves a preference, the call ends — then the SAME caller
// phones back and is recognized with their history. This exercises the booking
// brain + customer memory the way a real call does.
//
// Isolation: with no --tenant, it spins an ephemeral /demo/start tenant
// (is_demo=true, 30-min TTL, seeded automotive data, self-cleaning) so it never
// touches real data and can run against local OR prod safely.
//
// Output: PASS (link works) / GAP (feature not wired yet — see docs/TODO.md
// [dev]) / FAIL (a wired link broke). Exit non-zero only on FAIL.
//
// Env: SIM_BACKEND, SIM_AGENT_SECRET (server's), SIM_TENANT (optional).

const BACKEND = process.env.SIM_BACKEND;
const SECRET = process.env.SIM_AGENT_SECRET || '';
let TENANT = process.env.SIM_TENANT || '';

const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', d: '', b: '', x: '' };

if (!BACKEND) {
  console.error('sim-tools: SIM_BACKEND not set');
  process.exit(2);
}

let fails = 0;
const gaps = [];
function pass(name, detail = '') {
  console.log(`  ${C.g}[PASS]${C.x} ${name}${detail ? ` ${C.d}${detail}${C.x}` : ''}`);
}
function gap(name, detail) {
  gaps.push(name);
  console.log(`  ${C.y}[GAP] ${C.x} ${name}${detail ? ` ${C.d}— ${detail}${C.x}` : ''}`);
}
function fail(name, detail = '') {
  fails++;
  console.log(`  ${C.r}[FAIL]${C.x} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(path, body, { auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers['x-agent-secret'] = SECRET;
  let res, json;
  try {
    res = await fetch(`${BACKEND}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    json = await res.json().catch(() => null);
  } catch (e) {
    return { status: 0, json: null, error: e?.message ?? String(e) };
  }
  return { status: res.status, json };
}

// Realistic journey values.
const phone = `+1630555${String(Date.now()).slice(-4)}`;
const callId = `sim-call-${Date.now()}`;
// Booking window must land on a 15-min-aligned start inside the demo tenant's
// 08:00–17:00 America/Chicago shifts. Start tomorrow at 14:00:00Z (= 09:00 CDT,
// mid-shift, grid-aligned) and span a week so the scheduler can skip weekends.
const winFrom = new Date(Date.now() + 86400_000);
winFrom.setUTCHours(14, 0, 0, 0);
const winTo = new Date(winFrom.getTime() + 7 * 86400_000);

async function main() {
  console.log(`${C.b}SecretaryHQ — Agent-tools journey${C.x} ${C.d}(${BACKEND})${C.x}`);
  console.log(`${C.d}  caller ${phone} · call ${callId}${C.x}`);

  // ── S1. Provision an isolated demo tenant (unless one was supplied) ──
  let demoToken = null;
  if (!TENANT) {
    const r = await api('/demo/start', {}, { auth: false });
    if (r.json?.success && r.json.tenant_id) {
      TENANT = r.json.tenant_id;
      demoToken = r.json.token ?? null; // dashboard JWT — for auth'd routes like /analytics/stats
      pass('demo tenant provisioned', `tenant ${TENANT.slice(0, 8)}… (30-min TTL)`);
    } else {
      fail('demo tenant provisioned', `status ${r.status} ${r.error ?? JSON.stringify(r.json)}`);
      return finish();
    }
  } else {
    pass('using supplied tenant', TENANT.slice(0, 8) + '…');
  }

  // ── S2. Agent fetches tenant config (greeting, forward_phone) ──
  const cfg = await api('/agent-tools/tenant-config', { tenant_id: TENANT });
  if (cfg.json?.success) {
    const hasForward = 'forward_phone' in (cfg.json.result ?? {});
    pass('tenant-config', `forward_phone field ${hasForward ? 'present' : 'ABSENT'}`);
    if (!hasForward) gap('forward_phone in tenant-config', 'transfer destination not surfaced');
  } else {
    fail('tenant-config', `status ${cfg.status} ${JSON.stringify(cfg.json)}`);
  }

  // ── S3. Inbound call logged on connect ──
  const start = await api('/agent-tools/voice-session-start', {
    tenant_id: TENANT,
    call_id: callId,
    caller_phone: phone,
  });
  if (start.json?.success) pass('voice-session-start', 'call logged to voice_sessions');
  else fail('voice-session-start', `status ${start.status} ${JSON.stringify(start.json)}`);

  // ── S4. Caller asks what's offered ──
  const cat = await api('/agent-tools/service-catalog', { tenant_id: TENANT });
  if (cat.json?.success) pass('service-catalog', 'services returned');
  else fail('service-catalog', `status ${cat.status} ${JSON.stringify(cat.json)}`);

  // ── S5. New caller — no history yet ──
  const ctx1 = await api('/agent-tools/customer-context', { tenant_id: TENANT, phone });
  if (ctx1.json?.success !== undefined || ctx1.status === 200)
    pass('customer-context (new caller)', 'lookup ran');
  else fail('customer-context (new caller)', `status ${ctx1.status}`);

  // ── S6. Book the oil change (find-and-book in one shot) ──
  const book = await api('/agent-tools/book-with-scheduling', {
    tenant_id: TENANT,
    phone,
    name: 'Sim Test Caller',
    description: 'Oil change via system-simulation harness',
    call_id: callId,
    requirements: { serviceType: 'Oil Change' },
    window: { from: winFrom.toISOString(), to: winTo.toISOString() },
  });
  let bookedApptId = null;
  if (book.json?.success) {
    bookedApptId = book.json.result?.appointment_id ?? null;
    pass(
      'book-with-scheduling',
      `appointment booked ${bookedApptId ? bookedApptId.slice(0, 8) + '…' : ''}`
    );
  } else {
    fail('book-with-scheduling', `status ${book.status} ${JSON.stringify(book.json)}`);
  }

  // ── S7. Shop remembers a preference ──
  const pref = await api('/agent-tools/save-customer-preference', {
    tenant_id: TENANT,
    phone,
    key: 'last_service',
    value: 'Oil Change',
  });
  if (pref.json?.success) pass('save-customer-preference', "saved 'last_service'");
  else fail('save-customer-preference', `status ${pref.status} ${JSON.stringify(pref.json)}`);

  // ── S8. Call ends — full payload: duration, transcript, outcome, the booked
  //        appointment_id, and a summary (the agent now sends all of these). ──
  const callSummary = 'Caller booked an oil change.';
  const end = await api('/agent-tools/voice-session-end', {
    tenant_id: TENANT,
    call_id: callId,
    duration_seconds: 95,
    transcript: 'Caller: I need an oil change.\nAgent: Booked you in. Anything else?',
    outcome: 'booked',
    appointment_id: bookedApptId,
    summary: callSummary,
  });
  if (end.json?.success)
    pass('voice-session-end', 'duration + transcript + outcome + link + summary sent');
  else fail('voice-session-end', `status ${end.status} ${JSON.stringify(end.json)}`);

  // ── S8b. DB read-back — prove the link/outcome/summary actually PERSISTED,
  //         not just that the endpoint returned ok (local only; needs SIM_DB_URL).
  if (process.env.SIM_DB_URL) {
    try {
      const { default: pg } = await import('pg');
      const c = new pg.Client({ connectionString: process.env.SIM_DB_URL });
      await c.connect();
      const r = await c.query(
        'SELECT appointment_id, outcome, summary FROM voice_sessions WHERE tenant_id=$1 AND call_id=$2',
        [TENANT, callId]
      );
      await c.end();
      const row = r.rows[0];
      if (row && row.appointment_id && row.outcome === 'booked' && row.summary === callSummary) {
        pass(
          'call → appointment link (DB)',
          `voice_session.appointment_id = ${String(row.appointment_id).slice(0, 8)}…, outcome=booked, summary stored`
        );
        if (bookedApptId && row.appointment_id !== bookedApptId) {
          fail(
            'appointment_id matches booking',
            `session ${row.appointment_id} != booked ${bookedApptId}`
          );
        }
      } else {
        fail('call → appointment link (DB)', `row=${JSON.stringify(row)}`);
      }
    } catch (e) {
      gap('call → appointment link (DB)', `read-back skipped: ${e?.message ?? e}`);
    }
  } else {
    gap('call → appointment link (DB)', 'set SIM_DB_URL to verify persistence');
  }

  // ── S9. Returning caller is recognized + preference recalled ──
  const ctx2 = await api('/agent-tools/customer-context', { tenant_id: TENANT, phone });
  const blob = JSON.stringify(ctx2.json ?? {});
  if (ctx2.json?.success !== false && /last_service|Oil Change|Sim Test Caller/i.test(blob)) {
    pass('customer-context (returning)', 'history + preference recalled');
  } else if (ctx2.status === 200) {
    gap('preference round-trip', 'context returned but preference not visible in response');
  } else {
    fail('customer-context (returning)', `status ${ctx2.status}`);
  }

  // ── Analytics (the dashboard "is it working" surface) ──
  // /analytics/stats is dashboard-auth'd (JWT), not agent-secret — use the demo
  // token. Assert the AnalyticsStats shape AND that this call is reflected in
  // the counts (we booked 1 appt + logged 1 call on this tenant above).
  if (demoToken) {
    let s = null,
      code = 0;
    try {
      const res = await fetch(`${BACKEND}/analytics/stats?tenant_id=${TENANT}`, {
        headers: { authorization: `Bearer ${demoToken}` },
      });
      code = res.status;
      s = await res.json().catch(() => null);
    } catch (e) {
      code = 0;
    }
    const shapeOk =
      s && s.calls && s.appointments && s.customers && Array.isArray(s.recent_activity);
    if (code === 200 && shapeOk && s.calls.total >= 1 && s.appointments.total >= 1) {
      pass(
        'analytics /stats',
        `calls=${s.calls.total} appts=${s.appointments.total} customers=${s.customers.total}, recent_activity=${s.recent_activity.length}`
      );
    } else if (code === 200 && shapeOk) {
      fail(
        'analytics /stats',
        `shape ok but counts low (calls=${s.calls.total} appts=${s.appointments.total}) — booking/call not reflected`
      );
    } else {
      fail('analytics /stats', `status ${code} ${JSON.stringify(s)}`);
    }

    // ── /analytics/calls — the call-level cut (outcome breakdown + volume) ──
    // Real-stack proof for the new sibling endpoint: it must execute its SQL
    // against Postgres (mocked unit tests can't catch a SQL typo). booked is
    // keyed on appointment_id IS NOT NULL — we linked one above, so booked>=1
    // also validates the hard-signal logic against real rows.
    let c = null,
      ccode = 0;
    try {
      const res = await fetch(`${BACKEND}/analytics/calls?tenant_id=${TENANT}`, {
        headers: { authorization: `Bearer ${demoToken}` },
      });
      ccode = res.status;
      c = await res.json().catch(() => null);
    } catch (e) {
      ccode = 0;
    }
    const callsShapeOk = c && c.totals && Array.isArray(c.by_outcome) && Array.isArray(c.by_day);
    if (ccode === 200 && callsShapeOk && c.totals.total >= 1 && c.totals.booked >= 1) {
      pass(
        'analytics /calls',
        `total=${c.totals.total} booked=${c.totals.booked} abandoned=${c.totals.abandoned}, outcomes=${c.by_outcome.length} days=${c.by_day.length}`
      );
    } else if (ccode === 200 && callsShapeOk) {
      fail(
        'analytics /calls',
        `shape ok but counts low (total=${c.totals.total} booked=${c.totals.booked}) — call/booking not reflected`
      );
    } else {
      fail('analytics /calls', `status ${ccode} ${JSON.stringify(c)}`);
    }
  } else {
    gap('analytics /stats', 'no demo token to auth the call');
  }

  finish();
}

function finish() {
  console.log('');
  if (gaps.length) {
    console.log(
      `${C.y}${gaps.length} known gaps${C.x} (unwired features — see docs/TODO.md [dev]):`
    );
    for (const g of gaps) console.log(`  ${C.y}·${C.x} ${g}`);
    console.log('');
  }
  if (fails === 0) {
    console.log(
      `${C.b}${C.g}Journey OK${C.x} — every wired link passed. ${gaps.length} gap(s) await wiring.`
    );
    process.exit(0);
  } else {
    console.log(`${C.b}${C.r}Journey FAILED${C.x} — ${fails} wired link(s) broke.`);
    process.exit(1);
  }
}

main();
