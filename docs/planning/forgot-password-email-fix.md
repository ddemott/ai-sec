# PLAN: Make password-reset email actually deliver (and fail loudly when it can't)

Architected 2026-07-27 (Fable). Implementer: follow the steps IN ORDER. Every
step says what to change, what to run, and what you must see. Do not improvise
beyond the steps; if a step's verification fails in a way the step doesn't
predict, STOP and report.

## The measured problem (do not re-diagnose)

- `POST /forgot-password` on prod: token row written, then the request **hung**
  (HTTP 000 after 30s, no response line ever logged). The handler is stuck in
  `await sendPasswordResetEmail(...)`.
- Transport is nodemailer → Gmail SMTP (`service: 'gmail'` shorthand,
  smtp.gmail.com:465). From Railway this is the exact transport that failed
  2026-07-17 (IPv6 `ENETUNREACH`, 60–120s per attempt) — see
  `docs/LESSONS_LEARNED.md`. The job-inquiry email was made fire-and-forget
  then; `/forgot-password` was not.
- Failure is invisible: only a `catch` logs, and a hang is not an error. No
  metric, no log line, spinner forever. A locked-out owner cannot recover
  their account.
- Bonus defect: when `EMAIL_USER`/`EMAIL_PASS` are unset, `getTransporter()`
  returns a **stub that resolves successfully** — in production that would be
  a silent no-op mailer. (Prod currently HAS creds; the stub must still never
  be able to lie in prod.)

## Design (three layers, smallest change that fixes each)

1. **Transport** (`systemEmail.ts`): explicit host/port + timeouts + IPv4
   preference, and a hard deadline around every send so no caller can ever
   hang longer than `EMAIL_SEND_DEADLINE_MS` (default 20s) regardless of what
   the socket does. Stub refuses to exist in production.
2. **Route** (`auth.ts` `/forgot-password`): stop awaiting the send. Return
   200 immediately (the token row is already durable), fire-and-forget the
   email with `.catch` → `errors_total{event="password_reset_email_failed"}`
   + a 5W log. This is byte-for-byte the 07-17 job-inquiry pattern
   (`messaging.ts:660`).
3. **Observability**: the invite path gets the same metric treatment in its
   existing catch. Port-request already routes through `logError` (metric
   included) — deadline from layer 1 bounds it; no route change.

All transport knowledge stays inside `systemEmail.ts`, so a future swap to an
HTTPS provider (Resend/Postmark — the durable fix, needs an API key from Dale)
replaces ONE function's internals and no call sites.

---

## Step 1 — Transport hardening in `src/services/communications/systemEmail.ts`

Replace the whole `getTransporter` block (lines ~3–18) with:

```ts
let transporter: Transporter | null = null;

/**
 * Hard ceiling on any single system-email send. The 2026-07-27 incident:
 * /forgot-password hung indefinitely inside sendMail (Gmail SMTP unreachable
 * from Railway — same transport failure as 2026-07-17), the user saw a spinner,
 * and nothing was logged because a hang is not an error. Whatever the socket
 * does, no caller waits longer than this.
 */
const EMAIL_SEND_DEADLINE_MS = Number(process.env.EMAIL_SEND_DEADLINE_MS ?? 20_000);

function getTransporter(): Transporter {
  if (transporter) return transporter;
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    // In production a silent stub is a mailer that LIES — every send "succeeds"
    // and no mail exists. Refuse instead; every caller already has a catch
    // path, so this surfaces as a logged, metered failure rather than a 500.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'EMAIL_USER/EMAIL_PASS unset in production — system email is not configured'
      );
    }
    transporter = {
      sendMail: () => Promise.resolve({ messageId: 'test-message-id' }),
    } as unknown as Transporter;
    return transporter;
  }
  transporter = nodemailer.createTransport({
    // Explicit host/port instead of the `service: 'gmail'` shorthand, so
    // SMTP_HOST/SMTP_PORT can point at any provider without a code change.
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: Number(process.env.SMTP_PORT ?? 465) === 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    // 2026-07-17: Railway→Gmail failed over IPv6 (ENETUNREACH) and each attempt
    // burned 60–120s. Prefer IPv4 and fail fast; the deadline below is the
    // guaranteed backstop even if these are ignored.
    family: 4,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  } as Parameters<typeof nodemailer.createTransport>[0]);
  return transporter;
}

/**
 * The single choke point every system email goes through: applies the From
 * line and the hard deadline. A send that outlives the deadline REJECTS —
 * callers' catch paths turn that into a metric + 5W log instead of a hang.
 */
async function sendSystemMail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const send = getTransporter().sendMail({
    from: `"SecretaryHQ" <${process.env.EMAIL_USER ?? 'no-reply@secretaryhq.com'}>`,
    ...opts,
  });
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`system email send exceeded ${EMAIL_SEND_DEADLINE_MS}ms deadline`)),
      EMAIL_SEND_DEADLINE_MS
    );
  });
  try {
    await Promise.race([send, deadline]);
  } finally {
    clearTimeout(timer);
    // A loser `send` that later rejects must not become an unhandled rejection.
    void send.catch(() => {});
  }
}
```

Then, in EACH of the four exported send functions
(`sendUserInviteEmail`, `sendPasswordResetEmail`, `sendJobInquiryEmail`,
`sendPortRequestEmail`), replace the trailing

```ts
  await getTransporter().sendMail({
    from: `"SecretaryHQ" <${process.env.EMAIL_USER ?? 'no-reply@secretaryhq.com'}>`,
    to,
    subject,
    text,
    html,
  });
```

with

```ts
  await sendSystemMail({ to, subject, text, html });
```

(`sendPortRequestEmail` is below the section shown in reviews — open the file
to its end; same shape.)

**Verify:** `npx tsc --noEmit` clean.

## Step 2 — Fire-and-forget in `src/routes/auth.ts`

At the imports, add `errorsTotal`:

```ts
import { errorsTotal } from '../services/metrics';
```

Replace (currently ~line 220):

```ts
        const resetLink = `${dashboardUrl}/reset-password?token=${rawToken}`;
        try {
          await sendPasswordResetEmail(email, resetLink, RESET_TTL_MINUTES);
        } catch (err) {
          req.log.error({ err }, 'Failed to send password reset email');
        }
```

with:

```ts
        const resetLink = `${dashboardUrl}/reset-password?token=${rawToken}`;
        // FIRE-AND-FORGET (2026-07-27). This send was awaited, and on prod the
        // SMTP connection HUNG — the token row was written, the user saw a
        // spinner until their browser gave up, and nothing was logged because a
        // hang is not an error. The token is already durable; the response must
        // not be hostage to the mail transport. Same fix as the 07-17
        // job-inquiry email (messaging.ts), same failure, same transport.
        void sendPasswordResetEmail(email, resetLink, RESET_TTL_MINUTES).catch((err: unknown) => {
          errorsTotal.inc({ event: 'password_reset_email_failed' });
          req.log.error(
            { err, email },
            'password reset email FAILED — token row exists but the user got no link; they will retry against the 3/hour rate limit'
          );
        });
```

## Step 3 — Metric on the invite path in `src/routes/users.ts`

In the existing `catch` around `sendUserInviteEmail` (~line 212), add one line
above the `req.log.error`:

```ts
        errorsTotal.inc({ event: 'user_invite_email_failed' });
```

`users.ts` — check whether `errorsTotal` is already imported; add
`import { errorsTotal } from '../services/metrics';` if not. Keep the `await`
here: the owner is watching the response and the Step-1 deadline now bounds it
to 20s worst-case.

`src/routes/provisioning.ts`: **no change** (already metered via `logError`,
now bounded by the deadline).

## Step 4 — Tests

### 4a. New file `tests/services/systemEmail.test.ts`

Three tests (mock nodemailer with `vi.mock('nodemailer', ...)`):

1. **`production + missing creds → send REJECTS (no silent stub)`** — set
   `process.env.NODE_ENV = 'production'`, delete `EMAIL_USER`/`EMAIL_PASS`
   (save/restore in beforeEach/afterEach; also reset the module-level
   `transporter` cache with `vi.resetModules()` + dynamic `import()` per test).
   Expect `sendPasswordResetEmail(...)` to reject with `/not configured/`.
2. **`deadline: a sendMail that never resolves rejects within the deadline`**
   — set `process.env.EMAIL_SEND_DEADLINE_MS = '50'`, provide creds, mock
   `createTransport` to return `{ sendMail: () => new Promise(() => {}) }`.
   Expect rejection matching `/deadline/` (real 50ms wait is fine — no fake
   timers needed).
3. **`non-production without creds still stubs (dev/test unaffected)`** —
   `NODE_ENV='test'`, no creds → resolves.

Each test carries the WHO/WHAT/WHEN/WHERE/WHY comment header (house rule) and
names the 2026-07-27 hang in WHY.

### 4b. Regression test in `tests/routes/auth.test.ts`

Add to the existing `POST /forgot-password handler` describe. The file already
mocks `systemEmail` at line 9 — extend that pattern:

```ts
    it('THE HANG: returns 200 immediately even when the email send never resolves', async () => {
      // WHO: a locked-out owner. WHAT: /forgot-password answered HTTP 000 on
      // prod 2026-07-27 because the handler AWAITED an SMTP send that hung.
      // WHY: the token row is durable before the send; the response must not
      // be hostage to the mail transport.
      vi.mocked(sysmail.sendPasswordResetEmail).mockReturnValueOnce(
        new Promise(() => {}) // never settles
      );
      // ...same route-invocation harness as the two existing forgot tests...
      // assert reply 200 arrives; guard the whole test with a 2s timeout so
      // the OLD code (which awaits) fails this test by timing out.
    }, 5000);
```

**Prove it catches the bug:** temporarily restore `await` in auth.ts, run this
one test, confirm it FAILS by timeout; restore the fix, confirm green. Say so
in the commit message.

### 4c. Run everything

```
npx vitest run tests/services/systemEmail.test.ts tests/routes/auth.test.ts tests/routes/users-routes.test.ts tests/routes/agentTools/agentTools.test.ts
npx vitest run          # full backend — must be 100% green
npm run checks
```

Note: `agentTools.test.ts` and `users-routes.test.ts` mock `systemEmail` at
the module level, so Step 1 must not break them; if one fails, the mock is
missing a newly-referenced export — fix the mock, not the code.

## Step 5 — Docs

- `docs/DEPLOYMENT.md` env table: add `EMAIL_SEND_DEADLINE_MS` (default
  20000), `SMTP_HOST` / `SMTP_PORT` (default smtp.gmail.com / 465), and note
  next to `EMAIL_USER`/`EMAIL_PASS`: "in production, missing creds now make
  sends FAIL LOUDLY instead of silently succeeding".
- Append to `docs/LESSONS_LEARNED.md` (one bullet, house style): awaited SMTP
  hang on /forgot-password; the 07-17 lesson had already named this transport
  and only one of its two call-site classes got the fix; a stub that returns
  success is a mailer that lies.

## Step 6 — Ship

Branch `fix/forgot-password-email-delivery` off current `origin/main`, commit
(pre-commit hooks run format/lint), push, PR, wait for 4/4 CI, merge. After
the Railway deploy lands (verify `/health` `started_at` moved — see CLAUDE.md
on SKIPPED being terminal), verify on prod:

```
time curl -s -m 30 -X POST https://secretary-hq-production.up.railway.app/forgot-password \
  -H 'content-type: application/json' -d '{"email":"daledemott@gmail.com"}'
```

Must return `{"success":true}` in **< 3s** (was: 30s timeout, HTTP 000). Then
check `railway logs --service secretary-hq` for either nothing (mail went out) or
the new `password_reset_email_failed` line (transport still down — expected
until the provider question is settled; the point is it is now VISIBLE and
the endpoint is fast). Mind the 3/hour rate limit on this endpoint when
retrying.

## Out of scope (decided, not forgotten)

- **Resend/Postmark migration** — the durable fix for Railway↔Gmail SMTP.
  Blocked on Dale choosing a provider + providing an API key. When it lands it
  replaces `sendSystemMail`'s internals only.
- SMS-channel reset (schema has `channel`; no UI or need yet).
- Any change to token TTL, rate limits, or the enumeration-safe 200.
