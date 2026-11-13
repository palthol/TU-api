#!/usr/bin/env node
/**
 * Enrollment-only subscription backfill from a filled roster CSV.
 * Default is dry-run. Writes nothing unless --apply and a matching confirmation.
 *
 * Usage:
 *   npm --workspace services/api run roster:backfill -- --csv ./tmp/subscription-roster.csv
 *   npm --workspace services/api run roster:backfill -- --csv ./tmp/subscription-roster.csv --apply --yes-i-reviewed=N
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { readSupabaseSecretKey } from '../src/lib/readSupabaseSecretKey.js';
import { parseBackfillArgs, runBackfill } from '../src/services/billing/subscriptionBackfill.js';
import { loadScriptEnv } from './loadScriptEnv.mjs';

function printHelp() {
  console.log(`Validate (default) or apply enrollment-only subscription backfill.

Usage:
  npm --workspace services/api run roster:backfill -- --csv ./tmp/subscription-roster.csv
  npm --workspace services/api run roster:backfill -- --csv ./tmp/subscription-roster.csv --apply --yes-i-reviewed=12

Options:
  --csv <path>                 Filled roster CSV (required)
  --apply                      Write enrollments (off by default)
  --yes-i-reviewed=<count>     Must equal would_create. Also accepted as a typed line.
  --log <path>                 Result JSON path (default: <csv>.backfill-result.json)
  -h, --help                   Show this help

Always passes create_initial_charge=false through the same enrollSubscription
helper as POST /api/admin/billing/subscriptions. No obligations or charge cron.

Env (names only): SUPABASE_URL, SUPABASE_SECRET_KEY
(SUPABASE_SERVICE_ROLE_KEY is used only when SUPABASE_SECRET_KEY is unset).`);
}

async function confirmCount(expected) {
  if (!stdin.isTTY) return null;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const line = await rl.question(
      `Type ${expected} to apply ${expected} enrollment(s) (empty cancels): `,
    );
    const n = Number.parseInt(String(line).trim(), 10);
    if (!Number.isInteger(n) || String(n) !== String(line).trim()) return null;
    return n;
  } finally {
    rl.close();
  }
}

async function main(argv) {
  loadScriptEnv();
  let args;
  try {
    args = parseBackfillArgs(argv);
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
  if (!args.csvPath) {
    console.error('csv_required');
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

  const csvPath = resolve(args.csvPath);
  const csvText = await readFile(csvPath, 'utf8');
  const supabase = createClient(supabaseUrl, secret);

  let confirmedCount = args.confirmedCount;
  if (args.apply && confirmedCount == null) {
    const preview = await runBackfill({
      supabase,
      csvText,
      apply: false,
      supabaseUrl,
    });
    process.stdout.write(preview.report);
    if (preview.result.totals.errors > 0) {
      process.exitCode = 1;
      return;
    }
    confirmedCount = await confirmCount(preview.result.totals.would_create);
    if (confirmedCount == null) {
      console.error('apply_confirmation_required');
      process.exitCode = 1;
      return;
    }
  }

  const ran = await runBackfill({
    supabase,
    csvText,
    apply: args.apply,
    confirmedCount,
    supabaseUrl,
  });
  process.stdout.write(ran.report);

  const logPath = resolve(args.logPath || `${csvPath}.backfill-result.json`);
  await writeFile(logPath, `${JSON.stringify(ran.log, null, 2)}\n`, 'utf8');
  console.log(`Wrote result log ${logPath}`);

  if (args.apply && ran.mode !== 'apply') {
    process.exitCode = 1;
    return;
  }
  if (ran.result.totals.errors > 0 || (ran.applied && ran.applied.errors.length > 0)) {
    process.exitCode = 1;
  }
}

await main(process.argv.slice(2));
