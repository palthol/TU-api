#!/usr/bin/env node
/**
 * Remove rows tied to disposable test data (scoped; does not purge the database).
 *
 * Markers (see scripts/lib/tu-test-data.mjs):
 *   - participants.email ends with @tu-test.invalid
 *   - sessions / notes with tu-test-run: (seeded schedule rows)
 *   - personal_finance_entries: [TU-TEST] name prefix, tu-test-run: in notes, or linked test account/charge
 *
 * Default: dry-run. Deletions require --execute.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Note: public.event_ledger is append-only; historical rows may still mention deleted UUIDs.
 */

import { createClient } from '@supabase/supabase-js';
import { TU_TEST_EMAIL_DOMAIN, TU_TEST_DISPLAY_PREFIX } from './lib/tu-test-data.mjs';

async function loadDotenv() {
  try {
    await import('dotenv/config');
  } catch {
    /* optional */
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function deleteIn(supabase, table, column, ids, execute) {
  if (!ids.length) return 0;
  let n = 0;
  for (const part of chunk([...new Set(ids)], 120)) {
    if (!execute) {
      n += part.length;
      continue;
    }
    const { error } = await supabase.from(table).delete().in(column, part);
    if (error) throw new Error(`${table} delete: ${error.message}`);
    n += part.length;
  }
  return n;
}

async function main() {
  await loadDotenv();
  const execute = process.argv.includes('--execute');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const emailPattern = `%@${TU_TEST_EMAIL_DOMAIN}`;

  const { data: partRows, error: pErr } = await supabase
    .from('participants')
    .select('id, merged_into_participant_id')
    .ilike('email', emailPattern);
  if (pErr) throw new Error(pErr.message);

  const participantIds = (partRows ?? []).map((r) => r.id);
  const mergedDupIds = (partRows ?? []).filter((r) => r.merged_into_participant_id).map((r) => r.id);
  const canonicalIds = (partRows ?? []).filter((r) => !r.merged_into_participant_id).map((r) => r.id);

  const accountIdSet = new Set();
  if (participantIds.length) {
    for (const part of chunk(participantIds, 100)) {
      const { data, error } = await supabase.from('account_members').select('account_id').in('participant_id', part);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) accountIdSet.add(r.account_id);
    }
  }
  const { data: acctRows } = await supabase.from('accounts').select('id').ilike('primary_contact_email', emailPattern);
  for (const r of acctRows ?? []) accountIdSet.add(r.id);
  const accountIds = [...accountIdSet];

  const chargeIds = [];
  if (accountIds.length) {
    for (const part of chunk(accountIds, 100)) {
      const { data, error } = await supabase.from('charges').select('id').in('account_id', part);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) chargeIds.push(r.id);
    }
  }

  const paymentIds = [];
  if (accountIds.length) {
    for (const part of chunk(accountIds, 100)) {
      const { data, error } = await supabase.from('payments').select('id').in('account_id', part);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) paymentIds.push(r.id);
    }
  }

  const personalFinanceIds = new Set();

  const { data: pf1 } = await supabase.from('personal_finance_entries').select('id').ilike('member_display_name', `${TU_TEST_DISPLAY_PREFIX}%`);
  for (const r of pf1 ?? []) personalFinanceIds.add(r.id);

  const { data: pf2 } = await supabase.from('personal_finance_entries').select('id').ilike('notes', '%tu-test-run:%');
  for (const r of pf2 ?? []) personalFinanceIds.add(r.id);

  for (const part of chunk(accountIds, 40)) {
    if (!part.length) continue;
    const { data, error } = await supabase.from('personal_finance_entries').select('id').in('account_id', part);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) personalFinanceIds.add(r.id);
  }
  for (const part of chunk(chargeIds, 40)) {
    if (!part.length) continue;
    const { data, error } = await supabase.from('personal_finance_entries').select('id').in('charge_id', part);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) personalFinanceIds.add(r.id);
  }

  const affiliateCreditIds = new Set();
  if (paymentIds.length) {
    for (const part of chunk(paymentIds, 80)) {
      const { data, error } = await supabase.from('affiliate_credits').select('id').in('source_payment_id', part);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) affiliateCreditIds.add(r.id);
    }
  }
  if (participantIds.length) {
    for (const part of chunk(participantIds, 80)) {
      const { data, error } = await supabase.from('affiliate_credits').select('id').in('referrer_participant_id', part);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) affiliateCreditIds.add(r.id);
    }
  }

  const receiptIds = new Set();
  if (accountIds.length) {
    for (const part of chunk(accountIds, 80)) {
      const { data, error } = await supabase.from('receipts').select('id, supersedes_receipt_id').in('account_id', part);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) receiptIds.add(r.id);
    }
  }
  if (paymentIds.length) {
    for (const part of chunk(paymentIds, 80)) {
      const { data, error } = await supabase.from('receipts').select('id, supersedes_receipt_id').in('payment_id', part);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) receiptIds.add(r.id);
    }
  }

  const receiptList = [...receiptIds];
  const superseding = [];
  const leaf = [];
  for (const id of receiptList) {
    const { data } = await supabase.from('receipts').select('supersedes_receipt_id').eq('id', id).maybeSingle();
    if (data?.supersedes_receipt_id) superseding.push(id);
    else leaf.push(id);
  }
  const receiptDeleteOrder = [...superseding, ...leaf];

  const refundIds = [];
  if (paymentIds.length) {
    for (const part of chunk(paymentIds, 80)) {
      const { data, error } = await supabase.from('payment_refunds').select('id').in('payment_id', part);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) refundIds.push(r.id);
    }
  }

  const subscriptionIds = [];
  if (accountIds.length) {
    for (const part of chunk(accountIds, 100)) {
      const { data, error } = await supabase.from('subscriptions').select('id').in('account_id', part);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) subscriptionIds.push(r.id);
    }
  }

  const referralIds = new Set();
  if (participantIds.length) {
    for (const part of chunk(participantIds, 80)) {
      const { data: a } = await supabase.from('affiliate_referrals').select('id').in('referrer_participant_id', part);
      const { data: b } = await supabase.from('affiliate_referrals').select('id').in('referred_participant_id', part);
      for (const r of [...(a ?? []), ...(b ?? [])]) referralIds.add(r.id);
    }
  }

  const relIds = new Set();
  if (participantIds.length) {
    for (const part of chunk(participantIds, 80)) {
      const { data: a } = await supabase.from('participant_relationships').select('id').in('participant_a_id', part);
      const { data: b } = await supabase.from('participant_relationships').select('id').in('participant_b_id', part);
      for (const r of [...(a ?? []), ...(b ?? [])]) relIds.add(r.id);
    }
  }

  const memberIds = [];
  if (accountIds.length) {
    for (const part of chunk(accountIds, 100)) {
      const { data, error } = await supabase.from('account_members').select('id').in('account_id', part);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) memberIds.push(r.id);
    }
  }

  const sessionIds = [];
  const { data: sess } = await supabase.from('sessions').select('id').or(`notes.ilike.%tu-test-run:%,session_label.ilike.%tu-test-run:%`);
  for (const r of sess ?? []) sessionIds.push(r.id);

  const attendanceIds = [];
  if (sessionIds.length) {
    for (const part of chunk(sessionIds, 80)) {
      const { data, error } = await supabase.from('attendance_records').select('id').in('session_id', part);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) attendanceIds.push(r.id);
    }
  }

  const usageIds = [];
  const entIds = [];
  const ovIds = [];
  if (participantIds.length) {
    for (const part of chunk(participantIds, 80)) {
      const u = await supabase.from('private_usage').select('id').in('participant_id', part);
      const e = await supabase.from('entitlement_credits').select('id').in('participant_id', part);
      const o = await supabase.from('access_overrides').select('id').in('participant_id', part);
      if (u.error) throw new Error(u.error.message);
      for (const r of u.data ?? []) usageIds.push(r.id);
      if (e.error) throw new Error(e.error.message);
      for (const r of e.data ?? []) entIds.push(r.id);
      if (o.error) throw new Error(o.error.message);
      for (const r of o.data ?? []) ovIds.push(r.id);
    }
  }

  const { data: leads } = await supabase.from('marketing_leads').select('id').ilike('email', emailPattern);
  const leadIds = (leads ?? []).map((r) => r.id);

  /** @type {{ table: string; column: string; ids: string[] }[]} */
  const steps = [
    { table: 'personal_finance_entries', column: 'id', ids: [...personalFinanceIds] },
    { table: 'affiliate_credits', column: 'id', ids: [...affiliateCreditIds] },
    { table: 'receipts', column: 'id', ids: receiptDeleteOrder },
    { table: 'payment_refunds', column: 'id', ids: refundIds },
    { table: 'payments', column: 'id', ids: paymentIds },
    { table: 'charges', column: 'id', ids: chargeIds },
    { table: 'subscriptions', column: 'id', ids: subscriptionIds },
    { table: 'affiliate_referrals', column: 'id', ids: [...referralIds] },
    { table: 'participant_relationships', column: 'id', ids: [...relIds] },
    { table: 'account_members', column: 'id', ids: memberIds },
    { table: 'attendance_records', column: 'id', ids: attendanceIds },
    { table: 'sessions', column: 'id', ids: sessionIds },
    { table: 'accounts', column: 'id', ids: accountIds },
    { table: 'marketing_leads', column: 'id', ids: leadIds },
    { table: 'private_usage', column: 'id', ids: usageIds },
    { table: 'entitlement_credits', column: 'id', ids: entIds },
    { table: 'access_overrides', column: 'id', ids: ovIds },
    { table: 'participants', column: 'id', ids: mergedDupIds },
    { table: 'participants', column: 'id', ids: canonicalIds },
  ];

  console.log(execute ? 'MODE: EXECUTE (deleting)\n' : 'MODE: dry-run (add --execute to delete)\n');
  console.log(`participants (${TU_TEST_EMAIL_DOMAIN}): ${participantIds.length}`);
  console.log(`accounts: ${accountIds.length} charges: ${chargeIds.length} payments: ${paymentIds.length}`);
  console.log(`receipts: ${receiptList.length} personal_finance_entries: ${personalFinanceIds.size}`);

  for (const step of steps) {
    if (!step.ids.length) continue;
    const n = await deleteIn(supabase, step.table, step.column, step.ids, execute);
    console.log(`  ${execute ? 'deleted' : 'would delete'} ${step.ids.length} from ${step.table}`);
  }

  console.log(execute ? '\nDone.' : '\nDry-run only. Re-run with --execute after review.');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
