/**
 * Load tu-test env without silently picking up a production-oriented API .env.
 *
 * Preference order (first existing file wins; existing process.env is not overridden):
 *   1. <repo>/.env.validation  — dedicated non-prod keys (gitignored)
 *   2. <repo>/.env             — only if present at repo root
 *
 * Does not load services/api/.env. That file often holds the operator's
 * production-shaped credentials. If it contains the production project ref,
 * seed/cleanup refuse to run even when targeting localhost.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  envFileLooksLikeProduction,
  PRODUCTION_SUPABASE_PROJECT_REF,
} from './tu-test-guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../..');

const CANDIDATES = ['.env.validation', '.env'];

export function tuTestEnvPaths() {
  return CANDIDATES.map((name) => path.join(REPO_ROOT, name));
}

export async function loadTuTestEnv() {
  let dotenvConfig;
  try {
    ({ config: dotenvConfig } = await import('dotenv'));
  } catch {
    dotenvConfig = null;
  }

  const loaded = [];
  if (dotenvConfig) {
    for (const envPath of tuTestEnvPaths()) {
      if (!fs.existsSync(envPath)) continue;
      dotenvConfig({ path: envPath, override: false });
      loaded.push(envPath);
      break;
    }
  }

  const apiEnvPath = path.join(REPO_ROOT, 'services/api/.env');
  if (fs.existsSync(apiEnvPath)) {
    const contents = fs.readFileSync(apiEnvPath, 'utf8');
    if (envFileLooksLikeProduction(contents)) {
      const err = new Error(
        `Refusing to run: services/api/.env references production (${PRODUCTION_SUPABASE_PROJECT_REF} or the Render API host). ` +
          'Point the API at local Supabase (http://127.0.0.1:54321) before seeding, or use a dedicated non-prod project. ' +
          'A local API process using production keys would write to production.',
      );
      err.code = 'TU_TEST_PRODUCTION_TARGET';
      throw err;
    }
  }

  return { loaded, repoRoot: REPO_ROOT };
}

export function resolveApiBase() {
  return (process.env.TU_TEST_API_BASE || process.env.API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
}

export function resolveSupabaseUrl() {
  return String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
}
