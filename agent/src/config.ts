import * as dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(here, '../../.env') });
dotenv.config({ path: resolve(here, '../.env'), override: true });

import { envSchema } from './configSchema.js';

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Agent config validation failed:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
