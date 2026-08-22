/**
 * Local HTTPS cert lookup has to survive both runtimes:
 *   ts-node-dev  → __dirname is <repo>/src
 *   node dist    → __dirname is <repo>/dist/src
 *
 * A single `../certs` only works for one of those. The 2026-08-21 working-tree
 * edit picked the ts-node path and would have broken `npm start`
 * (`node dist/src/index.js`).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { resolveLocalHttpsCertDir } from '../../src/localHttpsCerts.js';

const temps: string[] = [];

function makeRepoLayout(): { repo: string; certDir: string } {
  const repo = mkdtempSync(path.join(tmpdir(), 'shq-certs-'));
  temps.push(repo);
  const certDir = path.join(repo, 'certs');
  mkdirSync(certDir);
  writeFileSync(path.join(certDir, 'localhost-key.pem'), 'test-key');
  writeFileSync(path.join(certDir, 'localhost-cert.pem'), 'test-cert');
  return { repo, certDir };
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveLocalHttpsCertDir', () => {
  it('finds repo/certs when running as src/index.ts', () => {
    const { repo, certDir } = makeRepoLayout();
    expect(resolveLocalHttpsCertDir(path.join(repo, 'src'))).toBe(certDir);
  });

  it('finds repo/certs when running as dist/src/index.js', () => {
    const { repo, certDir } = makeRepoLayout();
    expect(resolveLocalHttpsCertDir(path.join(repo, 'dist', 'src'))).toBe(certDir);
  });

  it('throws when neither layout has a key file', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'shq-certs-empty-'));
    temps.push(empty);
    expect(() => resolveLocalHttpsCertDir(path.join(empty, 'src'))).toThrow(
      /localhost HTTPS certs not found/
    );
  });
});
