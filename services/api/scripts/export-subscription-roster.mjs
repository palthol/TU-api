#!/usr/bin/env node
/**
 * Read-only CSV roster for monthly subscription enrollment backfill.
 *
 * Usage:
 *   npm --workspace services/api run roster:export -- --out ./tmp/subscription-roster.csv
 *
 * Env: SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).
 * Never prints secret values. Default is a file write of PII; keep it local.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { readSupabaseSecretKey } from '../src/lib/readSupabaseSecretKey.js';
import { parseExportArgs, runExport } from '../src/services/billing/subscriptionBackfill.js';
import { loadScriptEnv } from './loadScriptEnv.mjs';

function printHelp() {
  console.log(`Export a read-only enrollment roster CSV (one row per active account/participant).

Usage:
  npm --workspace services/api run roster:export -- --out ./tmp/subscription-roster.csv
  node services/api/scripts/export-subscription-roster.mjs --out ./tmp/subscription-roster.csv

Options:
  --out <path>         Roster CSV path (required)
  --plans-out <path>   Optional active-plans reference CSV (default: <out>.plans.csv)
  -h, --help           Show this help

Env (names only): SUPABASE_URL, SUPABASE_SECRET_KEY
(SUPABASE_SERVICE_ROLE_KEY is used only when SUPABASE_SECRET_KEY is unset).

This command only reads. It does not enroll, charge, or create obligations.`);
}

async function main(argv) {
  loadScriptEnv();
  let args;
  try {
    args = parseExportArgs(argv);
  } catch (error) {
    console.error(error.code || error.message);
    printHelp();
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.outPath) {
    console.error('out_required');
    printHelp();
    process.exitCode = 1;
    return;
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const secret = readSupabaseSecretKey();
  if (!supabaseUrl || !secret) {
    console.error('missing_supabase_env (need SUPABASE_URL and SUPABASE_SECRET_KEY)');
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(supabaseUrl, secret);
  const exported = await runExport({ supabase, supabaseUrl });
  const outPath = resolve(args.outPath);
  const plansOutPath = resolve(args.plansOutPath || `${outPath}.plans.csv`);
  await mkdir(dirname(outPath), { recursive: true });
  await mkdir(dirname(plansOutPath), { recursive: true });
  await writeFile(outPath, exported.rosterCsv, 'utf8');
  await writeFile(plansOutPath, exported.plansCsv, 'utf8');

  console.log(`Target: ${exported.target.host} (${exported.target.label})`);
  console.log(`Today (America/New_York): ${exported.today}`);
  console.log(`Wrote ${exported.rosterRows.length} roster row(s) to ${outPath}`);
  console.log(`Wrote ${exported.plans.length} active plan(s) to ${plansOutPath}`);
  process.stdout.write(exported.plansText);
}

await main(process.argv.slice(2));
