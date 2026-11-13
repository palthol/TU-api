import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Load services/api/.env then repo-root .env. Existing process env wins.
 * Never logs values.
 */
export function loadScriptEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const apiDir = resolve(here, '..');
  const repoRoot = resolve(apiDir, '../..');
  for (const path of [resolve(apiDir, '.env'), resolve(repoRoot, '.env')]) {
    if (existsSync(path)) dotenv.config({ path, override: false });
  }
}
