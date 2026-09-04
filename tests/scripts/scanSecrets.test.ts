/**
 * The pre-merge secret gate (T-012).
 *
 * WHO: every PR into `main`.
 * WHAT: the scanner trips on live credentials and stays quiet on placeholders.
 * WHEN: CI, on every push to a PR.
 * WHERE: scripts/scan-secrets.ts, invoked by .github/workflows/pre-merge-checks.yml.
 * WHY: a rule that lives only inside a workflow step is never exercised until
 *      the day it should fire — and a scanner has TWO failure modes, both
 *      silent. Miss a real key and it is in git history forever (removing the
 *      line does not un-leak it; only rotation does). Fire on placeholders and
 *      people learn to bypass the gate, which is the same as not having one.
 *      Both directions are asserted below.
 *
 * Every literal in this file is a SYNTHETIC pattern-shaped string. None of them
 * is, or ever was, a working credential.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { scanContent, looksLikePlaceholder, redact, scanRepo } from '../../scripts/scan-secrets';

/**
 * Credential-shaped strings are ASSEMBLED AT RUNTIME, never written as literals.
 *
 * GitHub push protection rejected the first version of this file: the fixture
 * `sk_live_51…` matched Stripe's real key shape well enough to be treated as a
 * live key, and the push was blocked at the remote. That is the platform gate
 * working exactly as intended — and the right response is to stop putting
 * key-shaped literals in the repository, not to click the allow-this-secret
 * link. Concatenation keeps the test honest (the scanner still receives the
 * full assembled string) while no line of this file reads as a credential to a
 * scanner, ours or GitHub's.
 */
const shaped = (prefix: string, body: string): string => `${prefix}${body}`;
const STRIPE_LIVE = shaped('sk_' + 'live_', 'A1b2C3d4E5f6G7h8I9j0K1l2');
const STRIPE_LIVE_SHORT = shaped('sk_' + 'live_', 'abcdefgh12345678');

const rulesFor = (content: string): string[] => scanContent('f.ts', content).map((f) => f.rule);

describe('scan-secrets: things that MUST trip the gate', () => {
  it.each([
    ['stripe_live_key', `const k = "${STRIPE_LIVE}";`],
    ['stripe_webhook_secret', 'STRIPE_WEBHOOK_SECRET=whsec_A1b2C3d4E5f6G7h8I9j0K1l2M3n4'],
    ['aws_access_key_id', 'aws_access_key_id = AKIA1234567890ABCDEF'],
    ['private_key_block', '-----BEGIN PRIVATE KEY-----'],
    ['openai_key', 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'],
    ['anthropic_key', 'ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwx'],
    ['slack_token', 'token: xoxb-123456789012-abcdefghijkl'],
    ['github_token', 'GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['postgres_url_with_password', 'DATABASE_URL=postgres://admin:s3cr3tPassw0rd@db.host/app'],
  ])('%s is detected', (rule, content) => {
    expect(rulesFor(content)).toContain(rule);
  });

  it('reports the file and 1-indexed line so the finding is actionable', () => {
    const findings = scanContent('src/config.ts', `ok\nok\nkey = "${STRIPE_LIVE_SHORT}"\n`);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: 'src/config.ts', line: 3, rule: 'stripe_live_key' });
    // The finding carries a REDACTED preview, never the match. The CLI prints
    // this, so a CI log on a public repo cannot become the second copy of the
    // leak (review catch on #395: the header claimed redaction while the CLI
    // printed no match at all — the claim and the code have to agree).
    expect(findings[0].preview).not.toContain('abcdefgh12345678');
    expect(findings[0].preview).toContain('sk_liv');
  });

  it('finds EVERY occurrence on one line, not just the first', () => {
    // A shared global RegExp keeps `lastIndex` between calls; forgetting to
    // reset it makes the scanner skip every other match, which reads as a clean
    // file. This is the assertion that catches that.
    const findings = scanContent('f.ts', 'a="AKIA1234567890ABCDEF" b="AKIAZZZZZZZZZZZZZZZZ"');
    expect(findings).toHaveLength(2);
  });
});

describe('scan-secrets: things that must NOT trip it', () => {
  it.each([
    ['a Stripe TEST key (fixtures use them on purpose)', 'sk_test_fakefakefake'],
    ['the short webhook secret in billing fixtures', 'whsec_test_secret'],
    ['an .env.example slot', 'DATABASE_URL=postgres://postgres:YOUR_PASSWORD@db.host/postgres'],
    ['an angle-bracketed doc slot', 'DATABASE_URL=postgres://app_user:<password>@<host>/<db>'],
    ['the local dev connection string', 'postgres://api_user:api_password@localhost:5433/test_db'],
    ['a UUID, which an entropy scanner would flag', 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0'],
    ['a git SHA', 'commit d0c31acdeadbeef1234567890abcdef1234567'],
  ])('%s is ignored', (_label, content) => {
    expect(scanContent('f.ts', content)).toEqual([]);
  });

  it('placeholder detection covers the shapes actually used in this repo', () => {
    for (const s of [
      'postgres://u:YOUR_PASSWORD@h/d',
      'postgres://u:<password>@h/d',
      shaped('sk_' + 'live_', 'xxxxxxxxxx'),
      shaped('sk_' + 'live_', 'example_key_here'),
    ]) {
      expect(looksLikePlaceholder(s), s).toBe(true);
    }
  });
});

describe('scan-secrets: the finding must not become a second copy of the leak', () => {
  it('redacts the matched value', () => {
    const out = redact(STRIPE_LIVE);
    expect(out).not.toContain('E5f6G7h8I9j0');
    expect(out).toContain('sk_liv');
    expect(out).toMatch(/\d+ chars/);
  });

  it('redacts a short match entirely rather than showing most of it', () => {
    expect(redact('abc123')).toBe('******');
  });
});

describe('scan-secrets: repo sweep', () => {
  it('SAD: a scanned file that cannot be read is skipped, not fatal', () => {
    // Binary blobs and deleted-but-tracked paths must not crash the gate — a
    // scanner that dies on one unreadable file reports nothing about the rest.
    const findings = scanRepo(
      (f) => {
        if (f === 'bad.bin') throw new Error('EISDIR');
        return `key = "${STRIPE_LIVE_SHORT}"`;
      },
      ['bad.bin', 'good.ts']
    );
    expect(findings.map((f) => f.file)).toEqual(['good.ts']);
  });

  it('HAPPY: the real repository is clean right now', () => {
    // Not a tautology — this is the assertion that fails the day someone
    // commits a live key, which is the entire point of the gate.
    expect(scanRepo((f) => readFileSync(f, 'utf8'))).toEqual([]);
  });
});
