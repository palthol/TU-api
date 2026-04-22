#!/usr/bin/env node
/**
 * Seed test participants + waivers (via public API) and optionally billing + schedule rows.
 *
 * Usage:
 *   node scripts/tu-test-seed.mjs [--count=2] [--billing] [--schedule]
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — required for --billing / --schedule
 *   TU_TEST_API_BASE (default http://localhost:3001) — waiver POST target
 *   TU_TEST_API_TIMEOUT_MS (default 20000) — health + submit timeout
 *
 * Participants use email tu-test-<runId>-<n>@tu-test.invalid (see scripts/lib/tu-test-data.mjs).
 */

import crypto from 'node:crypto';
import {
  assertTuTestEmail,
  tuTestDisplayName,
  tuTestEmail,
  tuTestRunNote,
} from './lib/tu-test-data.mjs';

const tinyPngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z2wAAAABJRU5ErkJggg==';

function parseArgs(argv) {
  const out = { count: 2, billing: false, schedule: false };
  for (const a of argv) {
    if (a.startsWith('--count=')) out.count = Math.max(1, Math.min(20, Number(a.slice(8)) || 1));
    else if (a === '--billing') out.billing = true;
    else if (a === '--schedule') out.schedule = true;
  }
  return out;
}

function plusYearsIsoDate(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function addDaysIso(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x.toISOString().slice(0, 10);
}

function requestTimeoutMs() {
  const raw = process.env.TU_TEST_API_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : 20_000;
  return Number.isFinite(n) && n >= 3000 ? n : 20_000;
}

function abortSignal() {
  const ms = requestTimeoutMs();
  return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

function printApiUnreachableHelp(apiBase, err) {
  const cause = err?.cause;
  const code = cause?.code ?? cause?.errno;
  console.error('\n--- API unreachable ---');
  console.error(`URL tried: ${apiBase}`);
  if (code) console.error(`Network: ${code} (${cause?.syscall ?? 'n/a'})`);
  console.error(`Message: ${err?.message ?? err}`);
  console.error('\nFix: start the waiver API, then retry.');
  console.error('  From repo root: npm run dev:api');
  console.error('If the API runs elsewhere, set TU_TEST_API_BASE or API_BASE_URL (no trailing slash).');
  console.error('Example: set TU_TEST_API_BASE=http://127.0.0.1:3001\n');
}

async function assertApiReachable(apiBase) {
  const healthUrl = `${apiBase}/health`;
  try {
    const res = await fetch(healthUrl, { method: 'GET', signal: abortSignal() });
    if (!res.ok) {
      console.warn(`Warning: ${healthUrl} returned HTTP ${res.status} (continuing anyway).`);
    }
  } catch (err) {
    printApiUnreachableHelp(apiBase, err);
    throw err;
  }
}

async function main() {
  try {
    await import('dotenv/config');
  } catch {
    /* optional */
  }

  const { count, billing, schedule } = parseArgs(process.argv.slice(2));
  const runId = crypto.randomUUID().slice(0, 8);
  const apiBase = (process.env.TU_TEST_API_BASE || process.env.API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');

  console.log(`API base: ${apiBase} (timeout ${requestTimeoutMs()} ms)`);
  await assertApiReachable(apiBase);

  const created = [];

  for (let i = 0; i < count; i++) {
    const suffix = `${runId}-${i}`;
    const email = tuTestEmail(suffix);
    assertTuTestEmail(email);

    const payload = {
      participant: {
        full_name: tuTestDisplayName(suffix, `Person ${i + 1}`),
        date_of_birth: plusYearsIsoDate(-21 - i),
        email,
        phone: `5558${String(100000 + i).slice(-6)}`,
        address_line: '1 Test Row',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
      },
      signature: { pngDataUrl: tinyPngDataUrl, vectorJson: [] },
      legal_confirmation: {
        accepted_terms: true,
        risk_initials: 'TT',
        release_initials: 'TT',
        indemnification_initials: 'TT',
        media_initials: 'TT',
      },
      review: { confirm_accuracy: true },
      locale: 'en',
      content_version: `tu-test.seed.${runId}`,
    };

    let res;
    try {
      res = await fetch(`${apiBase}/api/waivers/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortSignal(),
      });
    } catch (err) {
      printApiUnreachableHelp(apiBase, err);
      process.exitCode = 1;
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      console.error(`Waiver submit failed for ${email}:`, res.status, body);
      process.exitCode = 1;
      return;
    }
    created.push({
      email,
      waiverId: body.waiverId,
      participantId: body.participantId,
      accountId: body.accountId,
    });
    console.log(`OK waiver ${i + 1}/${count}: participant=${body.participantId} account=${body.accountId}`);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if ((billing || schedule) && (!supabaseUrl || !supabaseKey)) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for --billing / --schedule).');
    process.exitCode = 1;
    return;
  }

  if (!billing && !schedule) {
    console.log('\nDone. runId=', runId, '\nCleanup later: node scripts/tu-test-cleanup.mjs --execute');
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey);

  if (billing && created[0]) {
    const { data: plan, error: pErr } = await supabase
      .from('plan_definitions')
      .select('id')
      .eq('name', 'Basic Group Plan')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (pErr || !plan?.id) {
      console.error('Could not load plan_definitions "Basic Group Plan". Run supabase seed or migrations.', pErr);
      process.exitCode = 1;
      return;
    }

    const first = created[0];
    const startsAt = new Date().toISOString().slice(0, 10);
    const coverageEnd = addDaysIso(new Date(), 32);
    const dueAt = addDaysIso(new Date(), 14);

    const { data: sub, error: sErr } = await supabase
      .from('subscriptions')
      .insert({
        account_id: first.accountId,
        participant_id: first.participantId,
        plan_definition_id: plan.id,
        status: 'active',
        starts_at: startsAt,
        ends_at: null,
        notes: tuTestRunNote(runId),
      })
      .select('id')
      .single();
    if (sErr || !sub?.id) {
      console.error('subscription insert failed', sErr);
      process.exitCode = 1;
      return;
    }

    const { data: chargeRow, error: cErr } = await supabase
      .from('charges')
      .insert({
        account_id: first.accountId,
        subscription_id: sub.id,
        amount_cents: 10_000,
        coverage_start: startsAt,
        coverage_end: coverageEnd,
        due_at: dueAt,
        status: 'open',
        notes: tuTestRunNote(runId),
      })
      .select('id')
      .single();
    if (cErr || !chargeRow?.id) {
      console.error('charge insert failed', cErr);
      process.exitCode = 1;
      return;
    }

    const { error: pfErr } = await supabase.from('personal_finance_entries').insert({
      entry_kind: 'invoice',
      member_display_name: tuTestDisplayName(runId, 'Loose invoice'),
      amount_cents: 2500,
      issued_by: 'tu-test-seed',
      notes: tuTestRunNote(runId),
      due_at: dueAt,
      invoice_status: 'draft',
    });
    if (pfErr) console.warn('personal_finance_entries (optional) insert:', pfErr.message);
    else console.log('OK billing: subscription + open charge + sample personal_finance invoice row');

    console.log(`  subscription_id=${sub.id} charge_id=${chargeRow.id}`);
  }

  if (schedule && created[0]) {
    const p0 = created[0].participantId;
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    const end = new Date(start);
    end.setHours(11, 0, 0, 0);

    const { data: session, error: sesErr } = await supabase
      .from('sessions')
      .insert({
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        session_label: tuTestRunNote(runId),
        notes: tuTestRunNote(runId),
      })
      .select('id')
      .single();
    if (sesErr || !session?.id) {
      console.error('session insert failed', sesErr);
      process.exitCode = 1;
      return;
    }

    const { error: arErr } = await supabase.from('attendance_records').insert({
      session_id: session.id,
      participant_id: p0,
      status: 'present',
      recorded_by: 'tu-test-seed',
    });
    if (arErr) {
      console.error('attendance_records insert failed', arErr);
      process.exitCode = 1;
      return;
    }
    console.log(`OK schedule: session_id=${session.id} attendance for participant ${p0}`);
  }

  console.log('\nDone. runId=', runId, '\nCleanup: node scripts/tu-test-cleanup.mjs --execute');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
