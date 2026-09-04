/**
 * Plaintext-secret scan for the pre-merge gate (T-012).
 *
 * WHY A SCRIPT AND NOT A `git grep` LINE IN THE YAML: a rule that lives only in
 * a workflow step cannot be unit-tested, so nobody finds out it stopped matching
 * until the day it should have fired and didn't. This one is exercised by
 * `tests/scripts/scanSecrets.test.ts` against strings that MUST trip it and
 * strings that must NOT.
 *
 * WHAT IT LOOKS FOR: live credentials that would be catastrophic in git history
 * — a Stripe live key, a Stripe webhook signing secret, an AWS access key id, a
 * private key block, a Slack/GitHub/OpenAI/Anthropic token. Deliberately NOT a
 * general entropy scan: high-entropy heuristics fire on hashes, UUIDs, and
 * base64 fixtures, and a gate that cries wolf gets bypassed within a week.
 *
 * WHAT IT DELIBERATELY IGNORES:
 *   - `sk_test_` / test-mode keys. They are not live money and they appear in
 *     fixtures on purpose (tests/routes/billing-routes.test.ts stubs one).
 *   - `docs/**` and this file's own pattern table, which must be able to SAY
 *     `sk_live_` in prose without failing the build that reads it.
 *   - Placeholder values (`xxx`, `...`, `<your-key>`, `changeme`, `example`).
 *     A committed placeholder is documentation, not a leak.
 *
 * Exit 0 = clean. Exit 1 = at least one finding, printed as
 * `path:line: rule [redacted-preview]`. The preview is `redact()`'s output —
 * a six-character prefix and a length — never the match itself: a CI log is
 * world-readable on a public repo, and a scanner that prints the secret it
 * found has leaked it a second time. The prefix is there because "which of the
 * four keys on this line" is the first thing you need to know, and a length
 * distinguishes a real credential from a placeholder at a glance.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

export interface SecretRule {
  name: string;
  /** Must be a global regex — the scanner uses matchAll. */
  pattern: RegExp;
}

/**
 * Patterns are written against the credential's own published shape. Each one
 * is anchored on a vendor prefix rather than on entropy, so a false positive
 * means the vendor's format changed, not that the file looked random.
 */
export const SECRET_RULES: SecretRule[] = [
  // Stripe live secret / restricted keys. `sk_test_` is excluded by the
  // negative lookahead: test keys are fixtures, not leaks.
  { name: 'stripe_live_key', pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{8,}/g },
  // Stripe webhook signing secret. Real ones are `whsec_` + 32+ chars; the
  // length floor is what keeps `whsec_test_secret` in the billing fixtures from
  // tripping it.
  { name: 'stripe_webhook_secret', pattern: /\bwhsec_[A-Za-z0-9]{24,}/g },
  { name: 'aws_access_key_id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'private_key_block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { name: 'openai_key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { name: 'anthropic_key', pattern: /\bsk-ant-[A-Za-z0-9_-]{24,}/g },
  { name: 'slack_token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { name: 'github_token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  // A Postgres URL carrying a real password. `postgres://user:password@` and
  // other obvious placeholders are filtered by looksLikePlaceholder below.
  { name: 'postgres_url_with_password', pattern: /\bpostgres(?:ql)?:\/\/[^\s:/@]+:[^\s@]{6,}@/g },
];

/**
 * Committed placeholders are documentation. Treating them as findings is how a
 * scanner trains people to pass `--no-verify`.
 */
export function looksLikePlaceholder(match: string): boolean {
  const lower = match.toLowerCase();
  return (
    lower.includes('xxx') ||
    lower.includes('...') ||
    lower.includes('changeme') ||
    lower.includes('example') ||
    lower.includes('placeholder') ||
    lower.includes('redacted') ||
    lower.includes('fake') ||
    // `YOUR_PASSWORD`, `your-project-id`, `<your-key>` — the shape every
    // .env.example uses to say "put yours here".
    lower.includes('your_') ||
    lower.includes('your-') ||
    lower.includes('<your') ||
    // Any angle-bracketed slot: `postgres://app_user:<password>@<host>/<db>`,
    // which is how the app_user migration DOCUMENTS the connection string it
    // does not contain.
    /<[a-z_-]+>/.test(lower) ||
    // The literal words a developer types when writing docs about a credential.
    /:(?:password|secret|token|postgres|app_user|api_password)@/.test(lower)
  );
}

export interface Finding {
  file: string;
  line: number;
  rule: string;
  /** `redact()`'s output for the matched text — never the match itself. */
  preview: string;
}

/** Redact so a CI log never becomes the second copy of the leak. */
export function redact(match: string): string {
  if (match.length <= 8) return '*'.repeat(match.length);
  return `${match.slice(0, 6)}…${'*'.repeat(6)} (${match.length} chars)`;
}

export function scanContent(file: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split('\n');
  lines.forEach((text, i) => {
    for (const rule of SECRET_RULES) {
      // Fresh lastIndex per line — a shared global regex is stateful and would
      // skip every other match.
      rule.pattern.lastIndex = 0;
      for (const m of text.matchAll(rule.pattern)) {
        if (looksLikePlaceholder(m[0])) continue;
        findings.push({ file, line: i + 1, rule: rule.name, preview: redact(m[0]) });
      }
    }
  });
  return findings;
}

/** Files git tracks, minus the paths where writing ABOUT a secret is the job. */
export function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 32e6 });
  return (
    out
      .split('\0')
      .filter(Boolean)
      .filter((f) => !f.startsWith('docs/'))
      // Local HTTPS dev cert. It IS a real private key and the rule is right to
      // see one — but it is a self-signed localhost key that no client trusts and
      // no production system uses (root DEVELOPMENT_WORKFLOW.md; the agent points
      // NODE_EXTRA_CA_CERTS at its public half). Excluding the path is honest;
      // weakening the private-key rule so this one slips through would blind the
      // scanner to the next key, which might be a real one.
      .filter((f) => !f.startsWith('certs/'))
      .filter((f) => f !== 'scripts/scan-secrets.ts')
      .filter((f) => f !== 'tests/scripts/scanSecrets.test.ts')
      // Lockfiles carry integrity hashes that no rule matches today, but they are
      // enormous and scanning them costs seconds for nothing.
      .filter((f) => !f.endsWith('package-lock.json'))
  );
}

export function scanRepo(readFile: (f: string) => string, files: string[] = trackedFiles()) {
  const findings: Finding[] = [];
  for (const f of files) {
    let content: string;
    try {
      content = readFile(f);
    } catch {
      continue; // binary or unreadable — nothing to scan
    }
    findings.push(...scanContent(f, content));
  }
  return findings;
}

/* c8 ignore start — CLI wiring, exercised by the workflow itself */
function isDirectRun(): boolean {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('scan-secrets.ts') || entry.endsWith('scan-secrets.js');
}

if (isDirectRun()) {
  const findings = scanRepo((f) => readFileSync(f, 'utf8'));
  if (findings.length === 0) {
    console.log('[scan-secrets] clean — no plaintext credentials in tracked files');
    process.exit(0);
  }
  console.error(`[scan-secrets] ${findings.length} finding(s):`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}: ${f.rule} [${f.preview}]`);
  console.error(
    '\nRotate the credential FIRST — it is in git history the moment it was committed, ' +
      'and removing the line does not un-leak it. Then remove it from the working tree.'
  );
  process.exit(1);
}
/* c8 ignore stop */
