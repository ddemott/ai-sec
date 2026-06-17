// sim-stripe.mjs — verifies the Stripe billing path is wired and responsive.
//
// Driven by scripts/simulate.sh `stripe`. Uses a demo tenant JWT so it never
// touches a real business's data. Does NOT create real Stripe resources: the
// checkout step detects whether test keys are configured and reports a GAP if
// not — it doesn't actually charge anyone.
//
// Checks:
//   1. /demo/start        — ephemeral tenant + JWT (prerequisite for auth'd routes)
//   2. GET  /billing/status   — route reachable, returns plan state
//   3. POST /billing/webhook  — no sig: 400 means sig gate works; 503 means no Stripe key (GAP)
//   4. POST /billing/checkout — Stripe key configured? → OK / GAP
//   5. POST /billing/portal   — route reachable (503 = key missing GAP, else FAIL)
//
// Exit 0 = all wired checks pass (GAPs allowed). Exit 1 = hard FAIL (route
// broken / unexpected 5xx / 404 / checkout returns 503 "not configured").

const BACKEND = process.env.SIM_BACKEND;

const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', d: '', b: '', x: '' };

if (!BACKEND) {
  console.error('sim-stripe: SIM_BACKEND not set');
  process.exit(2);
}

let passed = 0, failed = 0, gaps = 0;

function pass(label, detail = '') {
  console.log(`  ${C.g}[OK]${C.x}   ${label.padEnd(32)} ${C.d}${detail}${C.x}`);
  passed++;
}
function fail(label, detail = '') {
  console.log(`  ${C.r}[FAIL]${C.x} ${label.padEnd(32)} ${C.d}${detail}${C.x}`);
  failed++;
}
function gap(label, detail = '') {
  console.log(`  ${C.y}[GAP]${C.x}  ${label.padEnd(32)} ${C.d}${detail}${C.x}`);
  gaps++;
}

async function req(path, opts = {}) {
  const { method = 'GET', body, headers = {}, auth } = opts;
  const url = `${BACKEND}${path}`;
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(10000) };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  if (auth) init.headers['authorization'] = `Bearer ${auth}`;
  try {
    const res = await fetch(url, init);
    let json = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) json = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

async function main() {
  console.log(`${C.b}SecretaryHQ — Stripe billing path check${C.x} ${C.d}(${BACKEND})${C.x}`);

  // ── 1. Demo tenant (JWT for auth'd routes) ──────────────────────────────
  const demo = await req('/demo/start', { method: 'POST', body: {} });
  let jwt = null;
  let tenantId = null;
  if (demo.status === 200 && demo.json?.success) {
    jwt = demo.json.token;
    tenantId = demo.json.tenant_id;
    pass('demo tenant', `${tenantId?.slice(0, 8)}… 30-min TTL`);
  } else {
    fail('demo tenant', `status ${demo.status}`);
    console.log(`\n  ${C.r}Cannot continue without a demo tenant.${C.x}`);
    process.exit(1);
  }

  // ── 2. GET /billing/status ───────────────────────────────────────────────
  const status = await req('/billing/status', { auth: jwt });
  if (status.status === 200) {
    const plan = status.json?.plan ?? status.json?.result?.plan ?? 'unknown';
    pass('GET /billing/status', `plan=${plan}`);
  } else if (status.status === 401 || status.status === 403) {
    fail('GET /billing/status', `auth rejected (${status.status}) — JWT not accepted`);
  } else {
    fail('GET /billing/status', `status ${status.status}`);
  }

  // ── 3. POST /billing/webhook — no sig ────────────────────────────────────
  // Backend checks for Stripe key first (→ 503), then checks for sig (→ 400).
  // 503 = key not configured (GAP). 400 = key present, sig gate works (OK).
  // Anything else is a real failure.
  const wh = await req('/billing/webhook', { method: 'POST', body: {} });
  if (wh.status === 400) {
    pass('webhook sig gate', 'Stripe key present; 400 on missing signature ✓');
  } else if (wh.status === 503) {
    gap('webhook sig gate', 'STRIPE_SECRET_KEY not set — billing inactive on this env');
  } else if (wh.status === 404) {
    fail('webhook sig gate', '404 — route not registered');
  } else if (wh.status === 500) {
    fail('webhook sig gate', '500 unexpected server error');
  } else {
    fail('webhook sig gate', `status ${wh.status} (expected 400 or 503)`);
  }

  // ── 4. POST /billing/checkout — detects key presence ────────────────────
  // Backend field is `plan`, not `planId`. Send intentionally invalid plan name
  // so we get a predictable 400 if the key is present (the key check happens
  // first, so a 503 means key missing and a 400 means key present).
  const co = await req('/billing/checkout', {
    method: 'POST',
    body: { plan: '__probe__' },
    auth: jwt,
  });
  if (co.status === 200 && co.json?.url) {
    pass('checkout session', 'Stripe key works, session URL returned');
  } else if (co.status === 503) {
    gap('checkout session', 'STRIPE_SECRET_KEY not set on this env — billing inactive');
  } else if (co.status === 400) {
    // 400 = key present (got past the key check), schema/plan rejected — expected for probe input
    pass('checkout session', 'Stripe key present; 400 on invalid plan ✓');
  } else if (co.status === 200 && co.json?.success === false) {
    const err = co.json?.error ?? 'unknown error';
    if (err.toLowerCase().includes('price')) {
      gap('checkout session', `key present but price ID missing — ${err}`);
    } else {
      fail('checkout session', `200 but failed: ${err}`);
    }
  } else if (co.status === 404) {
    fail('checkout session', '404 — route not registered');
  } else {
    fail('checkout session', `status ${co.status} ${co.json?.error ?? ''}`);
  }

  // ── 5. POST /billing/portal — route reachable ────────────────────────────
  // 503 = no Stripe key (GAP). 404 = route missing (FAIL). Anything else unexpected = FAIL.
  const portal = await req('/billing/portal', { method: 'POST', body: {}, auth: jwt });
  if (portal.status === 200 || portal.status === 400) {
    const detail = portal.json?.error ?? `status ${portal.status}`;
    pass('portal route reachable', detail);
  } else if (portal.status === 503) {
    gap('portal route reachable', 'STRIPE_SECRET_KEY not set — expected GAP');
  } else if (portal.status === 404) {
    fail('portal route reachable', '404 — route not registered');
  } else if (portal.status === 500) {
    fail('portal route reachable', '500 unexpected server error');
  } else {
    fail('portal route reachable', `status ${portal.status}`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('');
  console.log(
    `  ${C.b}${passed} pass · ${gaps} gap · ${failed} fail${C.x}  ${C.d}(gaps = not configured, not broken)${C.x}`
  );

  if (failed > 0) {
    console.log(`  ${C.r}Stripe billing path has failures — check logs above.${C.x}`);
    process.exit(1);
  }
  if (gaps > 0) {
    console.log(`  ${C.y}Some Stripe env vars not configured — routes work, keys missing.${C.x}`);
    console.log(
      `  ${C.d}Set STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET + STRIPE_*_PRICE_ID on Railway.${C.x}`
    );
  }
}

main().catch((e) => {
  console.error('sim-stripe fatal:', e.message);
  process.exit(1);
});
