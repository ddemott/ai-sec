/**
 * Guard: a migration must NOT manage its own transaction.
 *
 * 5W:
 *   WHO  — anyone running `npm run db:migrate` or `npm run db:rebuild`
 *   WHAT — no migration file may contain a top-level `BEGIN;` or `COMMIT;`
 *   WHEN — CI, on every PR
 *   WHERE— supabase/migrations/*.sql, enforced against scripts/setup-db.sh
 *   WHY  — the runner already owns the transaction. It applies each file as:
 *
 *            psql --single-transaction <<SQL
 *            \i <file>
 *            INSERT INTO schema_migrations (version, filename) VALUES (...);
 *            SQL
 *
 *          `--single-transaction` wraps that whole input. A file carrying its
 *          own `COMMIT;` therefore ENDS the runner's transaction early, and the
 *          `schema_migrations` INSERT lands outside it. That breaks the
 *          all-or-nothing guarantee the script's own comment promises — a
 *          failure after the file's COMMIT leaves DDL applied with no tracking
 *          row, so the next run tries to re-apply a migration that already ran.
 *          The file's own `BEGIN;` is separately useless: it raises
 *          "there is already a transaction in progress" and does nothing.
 *
 *          42 files carried this when the guard was written (2026-08-21). They
 *          were inert against prod, where all 42 had already been applied — the
 *          damage was confined to fresh rebuilds and new environments, which is
 *          exactly where nobody was watching.
 *
 * This is a static check on purpose: it costs milliseconds and catches the next
 * one at review time rather than during someone's broken rebuild.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');

/**
 * Lines that are exactly `BEGIN;` or `COMMIT;` at the top level.
 *
 * Dollar-quoted bodies are skipped, and that means TAGGED delimiters too, not
 * just `$$`. These migrations use six of them — `$guard$`, `$role$`,
 * `$verify$`, `$function$`, `$rewrite$`, `$close_gaps$` — and a detector that
 * only knew `$$` would treat those bodies as top level. `DO $guard$ BEGIN … END
 * $guard$;` is plpgsql block syntax, not a transaction, and flagging it would
 * push authors to write worse SQL to appease the guard.
 *
 * Matching is by tag identity, pushed and popped as a stack, because an opening
 * `$guard$` is only closed by another `$guard$` — a `$$` appearing inside it
 * does not end it.
 */
const DOLLAR_TAG = /\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g;

function topLevelTransactionLines(sql: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = [];
  const openTags: string[] = [];
  sql.split('\n').forEach((raw, i) => {
    if (openTags.length === 0 && /^\s*(BEGIN|COMMIT)\s*;\s*$/.test(raw)) {
      hits.push({ line: i + 1, text: raw.trim() });
    }
    for (const tok of raw.match(DOLLAR_TAG) ?? []) {
      if (openTags.length > 0 && openTags[openTags.length - 1] === tok) openTags.pop();
      else openTags.push(tok);
    }
  });
  return hits;
}

describe('migrations do not manage their own transaction', () => {
  it('SAD: no migration file contains a top-level BEGIN; or COMMIT;', () => {
    // WHY: see the header. The failure this prevents is silent — a rebuild that
    //      half-applies and reports success.
    // Sorted: readdirSync order is filesystem-dependent, and an unsorted
    // offender list makes a CI failure diff differently on every run.
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const f of files) {
      const hits = topLevelTransactionLines(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8'));
      for (const h of hits) offenders.push(`${f}:${h.line} → ${h.text}`);
    }

    expect(offenders).toEqual([]);
  });

  it('HAPPY: the detector does NOT flag a TAGGED plpgsql block', () => {
    // WHO: every migration using `DO $guard$` / `$role$` / `$verify$` — six
    //      distinct tags appear across this directory.
    // WHY: a `$$`-only detector treats a tagged body as top level and flags the
    //      `BEGIN` inside it. Caught in review of this PR; the same `$$`-only
    //      assumption was in the one-off script that stripped the 42 files,
    //      which is why that strip was re-verified tag-aware against the
    //      originals (every removed line was genuinely top level).
    const tagged = [
      'DO $guard$',
      'BEGIN;',
      "  RAISE NOTICE 'inside a tagged body';",
      'COMMIT;',
      'END $guard$;',
    ].join('\n');
    expect(topLevelTransactionLines(tagged)).toEqual([]);
  });

  it('HAPPY: the detector does NOT flag plpgsql DO $$ BEGIN ... END $$ blocks', () => {
    // WHO: every migration that creates a policy conditionally — most of the
    //      recent ones.
    // WHY: a guard that fires on legitimate plpgsql would push authors to
    //      write worse SQL to appease it, which is worse than no guard. Pin the
    //      distinction so a future tightening of the regex cannot blur it.
    const plpgsql = [
      'DO $$',
      'BEGIN',
      '  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 1) THEN',
      '    CREATE POLICY x ON y USING (true);',
      '  END IF;',
      'END $$;',
    ].join('\n');
    expect(topLevelTransactionLines(plpgsql)).toEqual([]);
  });

  it('HAPPY: the detector DOES flag a real top-level transaction', () => {
    // WHY: a guard nobody has watched fail is not a guard. This is the positive
    //      control for the assertion above.
    const withTx = ['BEGIN;', 'ALTER TABLE t ADD COLUMN c int;', 'COMMIT;'].join('\n');
    expect(topLevelTransactionLines(withTx)).toEqual([
      { line: 1, text: 'BEGIN;' },
      { line: 3, text: 'COMMIT;' },
    ]);
  });
});
