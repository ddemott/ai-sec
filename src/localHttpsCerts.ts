import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve repo/certs from either runtime layout:
 *   ts-node-dev src/index.ts  → __dirname is <repo>/src
 *   node dist/src/index.js    → __dirname is <repo>/dist/src
 *
 * A single relative hop only works for one of those. `npm start` uses the
 * compiled path (scripts/start-all.sh), so the hop count cannot be "fixed"
 * by deleting a `..`.
 */
export function resolveLocalHttpsCertDir(fromDir: string): string {
  const candidates = [
    path.resolve(fromDir, '..', 'certs'),
    path.resolve(fromDir, '..', '..', 'certs'),
  ];
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, 'localhost-key.pem')));
  if (!found) {
    throw new Error('localhost HTTPS certs not found in expected certs directories');
  }
  return found;
}
