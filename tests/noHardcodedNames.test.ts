/**
 * NO REAL PERSON'S NAME MAY BE HARDCODED IN SHIPPING CODE.
 *
 * WHY THIS EXISTS (2026-07-14). Three of them were, all in routes that EVERY tenant
 * on the platform shares:
 *
 *   - scheduling.ts, SPOKEN TO THE CALLER when booking options fail to load:
 *       "Would you like to leave a message and I'll have Dale get back to you?"
 *     A customer ringing Bella's Hair Studio was told a man named Dale would call
 *     them back.
 *   - messaging.ts, capture_job_inquiry's spoken reply: "I've passed those details
 *     along to Dale."
 *   - tools.ts, identify_caller's parameter example: 'e.g. "Dale DeMott"' — sent to
 *     the LLM on every call for every tenant, putting a real person's name in every
 *     customer's prompt and biasing the model toward a name it saw in its own
 *     instructions.
 *
 * None of these were caught by a test, because each one is a perfectly valid string.
 * They are only wrong because of WHOSE NAME IT IS — and that is not something a type
 * or a schema can know. It needs a test that knows the name.
 *
 * The failure mode is quiet and embarrassing rather than loud: nothing errors, CI is
 * green, and a stranger's business tells its customers that Dale will get back to
 * them.
 *
 * SCOPE: string literals and identifiers in shipping code. COMMENTS ARE FINE and
 * deliberately not flagged — they are history and they explain why this file exists.
 * Test files and demo seed data are excluded (a demo tenant's fake staff are the
 * point).
 *
 * If the platform gains another human whose name might leak (a founder, a support
 * rep), add them to DENY. The cost of a false positive here is renaming a variable;
 * the cost of a miss is a customer hearing it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';

const ROOT = resolve(__dirname, '..');

/** Real people / real private identifiers. Not personas, not demo data. */
const DENY = [
  'dale',
  'demott',
  'thinkinghammer',
  // "Clara" and "Chris" are DELIBERATELY absent: Clara is the built-in default
  // persona (a fiction, and the documented fallback when a tenant sets no assistant
  // name), and Chris is a tenant's chosen persona_name that lives in the DATABASE,
  // not the code. A persona is a product decision. A real person's name is a leak.
];

const SHIPPING_DIRS = ['src', 'agent/src', 'shared'];

/**
 * Walk the tree by hand rather than with fs.globSync.
 *
 * globSync is EXPERIMENTAL and version-dependent: it found 200+ files locally and ZERO
 * on CI's Node, so the guard scanned nothing and would have passed vacuously — except
 * that it also asserts it scanned >50 files, which is the only reason we found out. A
 * guard that silently protects nothing is worse than no guard, because it is believed.
 * readdirSync is boring and works everywhere.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...walk(rel));
    } else if (entry.name.endsWith('.ts')) {
      out.push(rel);
    }
  }
  return out;
}

/** Strip comments so history and rationale don't trip the guard — only CODE counts. */
function stripComments(src: string): string {
  return (
    src
      // block comments, incl. the big JSDoc headers this codebase leans on
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // line comments — but NOT the "//" inside a URL (https://…)
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
  );
}

describe('no real person is hardcoded into shipping code', () => {
  it("SAD: a tenant's caller must never be told that 'Dale' will get back to them", () => {
    const offenders: string[] = [];

    const files = SHIPPING_DIRS.flatMap((d) =>
      walk(d).filter(
        (f) =>
          !f.endsWith('.test.ts') &&
          // Demo/seed data invents people ON PURPOSE — that is what it is for.
          !f.includes('demoSeed') &&
          !f.includes('test-utils')
      )
    );

    // Sanity: if the glob silently matched nothing, this test would pass vacuously
    // and guard NOTHING — the exact failure this whole codebase keeps re-learning
    // (an eval that does not reproduce production does not test production).
    expect(files.length, 'guard scanned no files — the globs are wrong').toBeGreaterThan(50);

    for (const file of files) {
      const code = stripComments(readFileSync(resolve(ROOT, file), 'utf8'));
      code.split('\n').forEach((line, i) => {
        for (const needle of DENY) {
          if (line.toLowerCase().includes(needle)) {
            offenders.push(`${relative(ROOT, file)}:${i + 1} → ${line.trim().slice(0, 100)}`);
          }
        }
      });
    }

    expect(
      offenders,
      `A real person's name is hardcoded in shipping code. These strings reach every ` +
        `tenant — spoken to their callers, or sent to the LLM in their prompt:\n\n` +
        offenders.join('\n') +
        `\n\nUse the tenant's own data (owner name, persona) or a neutral word like ` +
        `"someone". A name you cannot look up is a name you must not invent.`
    ).toEqual([]);
  });
});
