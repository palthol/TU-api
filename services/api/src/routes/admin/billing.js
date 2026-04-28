/**
 * Admin billing routes (service-role Supabase RPCs).
 * All routes assume requireAdmin middleware (x-admin-key).
 */

const PAYMENT_METHODS = new Set(['cash', 'card', 'cashapp', 'venmo', 'paypal', 'zelle', 'other']);

/**
 * Remaining allocatable cents on a charge (net due minus existing allocations).
 */
async function getChargeAllocatableCents(supabase, chargeId) {
  const { data: netRow } = await supabase.from('view_charge_net').select('net_due_cents').eq('charge_id', chargeId).maybeSingle();
  const { data: ch } = await supabase.from('charges').select('amount_cents').eq('id', chargeId).maybeSingle();
  const netDue = netRow?.net_due_cents ?? ch?.amount_cents ?? 0;
  const { data: allocs } = await supabase.from('payment_allocations').select('amount_cents').eq('charge_id', chargeId);
  const allocated = (allocs || []).reduce((s, r) => s + r.amount_cents, 0);
  return Math.max(0, netDue - allocated);
}

/**
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient }} ctx
 */
export function registerAdminBillingRoutes(router, { supabase }) {
  router.get('/billing/charge-discounts', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const chargeId = typeof req.query.charge_id === 'string' ? req.query.charge_id.trim() : '';
      const limit = Math.min(Number.parseInt(String(req.query.limit || ''), 10) || 50, 200);
      if (!chargeId) {
        return res.status(400).json({ ok: false, error: 'charge_id_required' });
      }
      const { data, error } = await supabase
        .from('charge_discounts')
        .select('*')
        .eq('charge_id', chargeId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) return res.status(400).json({ ok: false, error: error.message });
      return res.json({ ok: true, rows: data ?? [] });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/billing/charge-discounts', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const { charge_id, discount_type, flat_amount_cents, percent_basis_points, label, reason, created_by } = req.body || {};
      if (!charge_id || typeof charge_id !== 'string') {
        return res.status(400).json({ ok: false, error: 'charge_id_required' });
      }
      if (!discount_type || (discount_type !== 'flat' && discount_type !== 'percent')) {
        return res.status(400).json({ ok: false, error: 'invalid_discount_type' });
      }
      if (!label || typeof label !== 'string' || !label.trim()) {
        return res.status(400).json({ ok: false, error: 'label_required' });
      }
      if (discount_type === 'flat' && (!Number.isFinite(flat_amount_cents) || flat_amount_cents <= 0)) {
        return res.status(400).json({ ok: false, error: 'invalid_flat_amount_cents' });
      }
      if (
        discount_type === 'percent' &&
        (!Number.isFinite(percent_basis_points) || percent_basis_points <= 0 || percent_basis_points > 10000)
      ) {
        return res.status(400).json({ ok: false, error: 'invalid_percent_basis_points' });
      }

      const insertRow = {
        charge_id: charge_id.trim(),
        discount_type,
        flat_amount_cents: discount_type === 'flat' ? flat_amount_cents : null,
        percent_basis_points: discount_type === 'percent' ? percent_basis_points : null,
        applied_amount_cents: 1,
        label: label.trim(),
        reason: reason && typeof reason === 'string' ? reason.trim() : null,
        created_by: created_by && typeof created_by === 'string' ? created_by.trim() : null,
      };

      const { data, error } = await supabase.from('charge_discounts').insert(insertRow).select('*').single();
      if (error) {
        console.error('charge_discounts.insert', error);
        return res.status(400).json({ ok: false, error: error.message });
      }

      const { data: netRow } = await supabase
        .from('view_charge_net')
        .select('net_due_cents')
        .eq('charge_id', charge_id.trim())
        .maybeSingle();

      return res.json({
        ok: true,
        discount_id: data.id,
        applied_amount_cents: data.applied_amount_cents,
        net_due_cents: netRow?.net_due_cents ?? null,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/billing/charge-adjustments', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const { charge_id, amount_cents, reason, created_by } = req.body || {};
      if (!charge_id || typeof amount_cents !== 'number' || amount_cents <= 0) {
        return res.status(400).json({ ok: false, error: 'invalid_charge_id_or_amount' });
      }
      if (!reason || typeof reason !== 'string' || !reason.trim()) {
        return res.status(400).json({ ok: false, error: 'reason_required' });
      }
      const { data, error } = await supabase
        .from('charge_adjustments')
        .insert({
          charge_id,
          adjustment_type: 'write_off',
          amount_cents,
          reason: reason.trim(),
          created_by: created_by || null,
        })
        .select('id')
        .single();
      if (error) {
        console.error('charge_adjustments.insert', error);
        return res.status(400).json({ ok: false, error: error.message });
      }
      return res.json({ ok: true, id: data.id });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/billing/payment-refunds', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const { payment_id, amount_cents, reason, idempotency_key } = req.body || {};
      if (!payment_id || typeof amount_cents !== 'number' || amount_cents <= 0) {
        return res.status(400).json({ ok: false, error: 'invalid_payment_or_amount' });
      }
      if (!reason || typeof reason !== 'string' || !reason.trim()) {
        return res.status(400).json({ ok: false, error: 'reason_required' });
      }
      const { data, error } = await supabase.rpc('record_payment_refund', {
        p_payment_id: payment_id,
        p_amount_cents: amount_cents,
        p_reason: reason.trim(),
        p_created_by: req.body?.created_by || 'admin_api',
        p_idempotency_key: idempotency_key || null,
      });
      if (error) {
        console.error('record_payment_refund', error);
        return res.status(400).json({ ok: false, error: error.message });
      }
      return res.json({ ok: true, refund_id: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/billing/subscription-upgrade', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const { subscription_id, new_plan_definition_id, effective_date } = req.body || {};
      if (!subscription_id || !new_plan_definition_id) {
        return res.status(400).json({ ok: false, error: 'subscription_and_plan_required' });
      }
      const { data, error } = await supabase.rpc('upgrade_subscription_prorated', {
        p_subscription_id: subscription_id,
        p_new_plan_definition_id: new_plan_definition_id,
        p_effective_date: effective_date || null,
      });
      if (error) {
        console.error('upgrade_subscription_prorated', error);
        return res.status(400).json({ ok: false, error: error.message });
      }
      return res.json({ ok: true, proration_charge_id: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/billing/per-class/charge-from-attendance', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const { attendance_record_id, due_at, notes, created_by } = req.body || {};
      if (!attendance_record_id) {
        return res.status(400).json({ ok: false, error: 'attendance_record_id_required' });
      }
      if (due_at != null && typeof due_at !== 'string') {
        return res.status(400).json({ ok: false, error: 'invalid_due_at' });
      }
      if (notes != null && typeof notes !== 'string') {
        return res.status(400).json({ ok: false, error: 'invalid_notes' });
      }

      const { data, error } = await supabase.rpc('create_pay_per_class_charge', {
        p_attendance_id: attendance_record_id,
        p_due_at: due_at || null,
        p_notes: notes || null,
        p_created_by: created_by || 'admin_api',
      });
      if (error) {
        console.error('create_pay_per_class_charge', error);
        return res.status(400).json({ ok: false, error: error.message });
      }

      return res.json({ ok: true, charge_id: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/billing/per-class/upgrade-to-monthly', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const {
        participant_id,
        new_plan_definition_id,
        effective_date,
        create_initial_charge,
        notes,
        conversion_policy,
      } = req.body || {};
      if (!participant_id || !new_plan_definition_id) {
        return res.status(400).json({ ok: false, error: 'participant_and_plan_required' });
      }
      if (effective_date != null && typeof effective_date !== 'string') {
        return res.status(400).json({ ok: false, error: 'invalid_effective_date' });
      }
      if (create_initial_charge != null && typeof create_initial_charge !== 'boolean') {
        return res.status(400).json({ ok: false, error: 'invalid_create_initial_charge' });
      }
      if (notes != null && typeof notes !== 'string') {
        return res.status(400).json({ ok: false, error: 'invalid_notes' });
      }
      if (conversion_policy != null && typeof conversion_policy !== 'string') {
        return res.status(400).json({ ok: false, error: 'invalid_conversion_policy' });
      }

      const { data, error } = await supabase.rpc('upgrade_per_class_to_monthly', {
        p_participant_id: participant_id,
        p_new_plan_definition_id: new_plan_definition_id,
        p_effective_date: effective_date || null,
        p_create_initial_charge: create_initial_charge ?? true,
        p_notes: notes || null,
        p_conversion_policy: conversion_policy || 'no_credit',
      });
      if (error) {
        console.error('upgrade_per_class_to_monthly', error);
        return res.status(400).json({ ok: false, error: error.message });
      }

      const row = Array.isArray(data) ? data[0] : data;
      return res.json({
        ok: true,
        old_subscription_id: row?.old_subscription_id || null,
        new_subscription_id: row?.new_subscription_id || null,
        initial_charge_id: row?.initial_charge_id || null,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  /**
   * Record a succeeded payment + allocations + optional money_in receipt.
   * Body: account_id, amount_cents, method, issued_by, allocations: [{ charge_id, amount_cents }],
   * paid_at?, reference?, notes?, issue_receipt? (default true)
   */
  router.post('/billing/record-payment', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const {
        account_id,
        amount_cents,
        method,
        issued_by,
        allocations,
        paid_at,
        reference,
        notes,
        issue_receipt,
      } = req.body || {};
      if (!account_id || typeof amount_cents !== 'number' || amount_cents <= 0) {
        return res.status(400).json({ ok: false, error: 'account_and_positive_amount_required' });
      }
      if (!method || typeof method !== 'string' || !PAYMENT_METHODS.has(method)) {
        return res.status(400).json({ ok: false, error: 'invalid_payment_method' });
      }
      if (!issued_by || typeof issued_by !== 'string' || !issued_by.trim()) {
        return res.status(400).json({ ok: false, error: 'issued_by_required' });
      }
      if (!Array.isArray(allocations) || allocations.length === 0) {
        return res.status(400).json({ ok: false, error: 'allocations_required' });
      }
      let sum = 0;
      for (const row of allocations) {
        if (!row.charge_id || typeof row.amount_cents !== 'number' || row.amount_cents <= 0) {
          return res.status(400).json({ ok: false, error: 'invalid_allocation_row' });
        }
        sum += row.amount_cents;
      }
      if (sum !== amount_cents) {
        return res.status(400).json({ ok: false, error: 'allocation_sum_must_equal_payment_amount' });
      }

      for (const row of allocations) {
        const { data: ch, error: chErr } = await supabase
          .from('charges')
          .select('id, account_id, status')
          .eq('id', row.charge_id)
          .maybeSingle();
        if (chErr || !ch) {
          return res.status(400).json({ ok: false, error: 'charge_not_found', charge_id: row.charge_id });
        }
        if (ch.account_id !== account_id) {
          return res.status(400).json({ ok: false, error: 'charge_account_mismatch', charge_id: row.charge_id });
        }
        if (ch.status === 'void') {
          return res.status(400).json({ ok: false, error: 'charge_is_void', charge_id: row.charge_id });
        }
        const headroom = await getChargeAllocatableCents(supabase, row.charge_id);
        if (row.amount_cents > headroom) {
          return res.status(400).json({
            ok: false,
            error: 'allocation_exceeds_net_due',
            charge_id: row.charge_id,
            allocatable_cents: headroom,
          });
        }
      }

      const { data: pay, error: payErr } = await supabase
        .from('payments')
        .insert({
          account_id,
          amount_cents,
          currency: 'USD',
          paid_at: paid_at || new Date().toISOString(),
          method,
          source: 'manual',
          status: 'succeeded',
          reference: reference || null,
          notes: notes || null,
        })
        .select('id')
        .single();
      if (payErr || !pay) {
        console.error('payments.insert', payErr);
        return res.status(400).json({ ok: false, error: payErr?.message || 'payment_insert_failed' });
      }

      const paymentId = pay.id;
      for (const row of allocations) {
        const { error: aErr } = await supabase.from('payment_allocations').insert({
          payment_id: paymentId,
          charge_id: row.charge_id,
          amount_cents: row.amount_cents,
        });
        if (aErr) {
          console.error('payment_allocations.insert', aErr);
          return res.status(400).json({ ok: false, error: aErr.message });
        }
      }

      const distinctChargeIds = [...new Set(allocations.map((a) => a.charge_id))];
      for (const cid of distinctChargeIds) {
        const { data: allocRows } = await supabase.from('payment_allocations').select('amount_cents').eq('charge_id', cid);
        const totalAlloc = (allocRows || []).reduce((s, r) => s + r.amount_cents, 0);
        const { data: netRow } = await supabase.from('view_charge_net').select('net_due_cents').eq('charge_id', cid).maybeSingle();
        const { data: ch } = await supabase.from('charges').select('amount_cents').eq('id', cid).maybeSingle();
        const netDue = netRow?.net_due_cents ?? ch?.amount_cents ?? 0;
        if (totalAlloc >= netDue && netDue > 0) {
          await supabase.from('charges').update({ status: 'paid', updated_at: new Date().toISOString() }).eq('id', cid);
        }
      }

      let receiptId = null;
      if (issue_receipt !== false) {
        const { data: rec, error: rErr } = await supabase
          .from('receipts')
          .insert({
            receipt_kind: 'money_in',
            payment_id: paymentId,
            account_id,
            amount_cents,
            currency: 'USD',
            issued_by: issued_by.trim(),
            source: 'staff_triggered',
          })
          .select('id')
          .single();
        if (rErr) {
          console.error('receipts.insert', rErr);
          return res.status(400).json({ ok: false, error: rErr.message, payment_id: paymentId });
        }
        receiptId = rec.id;
      }

      return res.json({ ok: true, payment_id: paymentId, receipt_id: receiptId });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/billing/receipts/:receiptId/void', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const receiptId = String(req.params.receiptId || '').trim();
      const { void_reason } = req.body || {};
      if (!receiptId || !void_reason || typeof void_reason !== 'string' || !void_reason.trim()) {
        return res.status(400).json({ ok: false, error: 'receipt_id_and_void_reason_required' });
      }
      const { data: existing, error: findErr } = await supabase
        .from('receipts')
        .select('id, voided_at')
        .eq('id', receiptId)
        .maybeSingle();
      if (findErr || !existing) {
        return res.status(404).json({ ok: false, error: 'receipt_not_found' });
      }
      if (existing.voided_at) {
        return res.status(400).json({ ok: false, error: 'receipt_already_voided' });
      }
      const { error: uErr } = await supabase
        .from('receipts')
        .update({
          voided_at: new Date().toISOString(),
          void_reason: void_reason.trim(),
        })
        .eq('id', receiptId);
      if (uErr) {
        return res.status(400).json({ ok: false, error: uErr.message });
      }
      return res.json({ ok: true, receipt_id: receiptId });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  /**
   * After a refund exists, issue money_out_refund receipt and void active money_in receipt for that payment.
   */
  router.post('/billing/receipts/issue-for-refund', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const { payment_refund_id, issued_by, notes } = req.body || {};
      if (!payment_refund_id || !issued_by || typeof issued_by !== 'string' || !issued_by.trim()) {
        return res.status(400).json({ ok: false, error: 'payment_refund_id_and_issued_by_required' });
      }
      const { data: ref, error: refErr } = await supabase
        .from('payment_refunds')
        .select('id, payment_id, amount_cents')
        .eq('id', payment_refund_id)
        .maybeSingle();
      if (refErr || !ref) {
        return res.status(404).json({ ok: false, error: 'payment_refund_not_found' });
      }
      const { data: existingOut } = await supabase
        .from('receipts')
        .select('id')
        .eq('payment_refund_id', payment_refund_id)
        .eq('receipt_kind', 'money_out_refund')
        .maybeSingle();
      if (existingOut) {
        return res.status(400).json({ ok: false, error: 'refund_receipt_already_exists', receipt_id: existingOut.id });
      }

      const { data: pay, error: payErr } = await supabase
        .from('payments')
        .select('id, account_id')
        .eq('id', ref.payment_id)
        .maybeSingle();
      if (payErr || !pay) {
        return res.status(400).json({ ok: false, error: 'payment_not_found' });
      }

      const { data: moneyIn } = await supabase
        .from('receipts')
        .select('id')
        .eq('payment_id', pay.id)
        .eq('receipt_kind', 'money_in')
        .is('voided_at', null)
        .maybeSingle();
      if (moneyIn) {
        await supabase
          .from('receipts')
          .update({
            voided_at: new Date().toISOString(),
            void_reason: 'Superseded by refund receipt',
          })
          .eq('id', moneyIn.id);
      }

      const { data: outRec, error: insErr } = await supabase
        .from('receipts')
        .insert({
          receipt_kind: 'money_out_refund',
          payment_id: pay.id,
          payment_refund_id: ref.id,
          account_id: pay.account_id,
          amount_cents: ref.amount_cents,
          currency: 'USD',
          issued_by: issued_by.trim(),
          notes: notes && typeof notes === 'string' ? notes.trim() : null,
          source: 'staff_triggered',
        })
        .select('id')
        .single();
      if (insErr) {
        return res.status(400).json({ ok: false, error: insErr.message });
      }
      return res.json({ ok: true, receipt_id: outRec.id, voided_money_in_receipt_id: moneyIn?.id || null });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.get('/billing/marketing-leads', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const limit = Math.min(Number.parseInt(String(req.query.limit || ''), 10) || 100, 500);
      const { data, error } = await supabase
        .from('marketing_leads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) return res.status(400).json({ ok: false, error: error.message });
      return res.json({ ok: true, rows: data ?? [] });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.get('/billing/operating-expenses', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const limit = Math.min(Number.parseInt(String(req.query.limit || ''), 10) || 100, 500);
      const { data, error } = await supabase
        .from('operating_expenses')
        .select('*')
        .order('expense_date', { ascending: false })
        .limit(limit);
      if (error) return res.status(400).json({ ok: false, error: error.message });
      return res.json({ ok: true, rows: data ?? [] });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/billing/operating-expenses', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const { category, amount_cents, expense_date, vendor_name, notes, created_by } = req.body || {};
      const cats = new Set(['rent', 'utilities', 'other']);
      if (!category || !cats.has(category)) {
        return res.status(400).json({ ok: false, error: 'invalid_category' });
      }
      if (typeof amount_cents !== 'number' || amount_cents <= 0) {
        return res.status(400).json({ ok: false, error: 'invalid_amount_cents' });
      }
      if (!expense_date || typeof expense_date !== 'string') {
        return res.status(400).json({ ok: false, error: 'expense_date_required' });
      }
      const { data, error } = await supabase
        .from('operating_expenses')
        .insert({
          category,
          amount_cents,
          expense_date,
          vendor_name: vendor_name || null,
          notes: notes || null,
          created_by: created_by || null,
        })
        .select('id')
        .single();
      if (error) return res.status(400).json({ ok: false, error: error.message });
      return res.json({ ok: true, id: data.id });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  /**
   * Personal operator log (no account/charge required): cash received or lightweight invoice rows.
   */
  router.post('/billing/personal-finance-entries', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const {
        entry_kind,
        member_display_name,
        amount_cents,
        method,
        issued_by,
        notes,
        due_at,
        invoice_status,
        account_id,
        charge_id,
      } = req.body || {};

      if (entry_kind !== 'cash_received' && entry_kind !== 'invoice') {
        return res.status(400).json({ ok: false, error: 'invalid_entry_kind' });
      }
      if (!member_display_name || typeof member_display_name !== 'string' || !member_display_name.trim()) {
        return res.status(400).json({ ok: false, error: 'member_display_name_required' });
      }
      if (typeof amount_cents !== 'number' || amount_cents <= 0) {
        return res.status(400).json({ ok: false, error: 'invalid_amount_cents' });
      }
      if (!issued_by || typeof issued_by !== 'string' || !issued_by.trim()) {
        return res.status(400).json({ ok: false, error: 'issued_by_required' });
      }

      let row = {
        entry_kind,
        member_display_name: member_display_name.trim(),
        amount_cents,
        issued_by: issued_by.trim(),
        notes: notes && typeof notes === 'string' ? notes.trim() : null,
        account_id: account_id || null,
        charge_id: charge_id || null,
      };

      if (entry_kind === 'cash_received') {
        if (!method || typeof method !== 'string' || !PAYMENT_METHODS.has(method)) {
          return res.status(400).json({ ok: false, error: 'invalid_payment_method' });
        }
        row = { ...row, method, due_at: null, invoice_status: null };
      } else {
        let due = due_at;
        if (!due || typeof due !== 'string') {
          const t = new Date();
          t.setUTCDate(t.getUTCDate() + 1);
          due = t.toISOString().slice(0, 10);
        }
        const invStatus =
          invoice_status && typeof invoice_status === 'string' ? invoice_status.trim() : 'draft';
        if (!['draft', 'sent', 'paid', 'void'].includes(invStatus)) {
          return res.status(400).json({ ok: false, error: 'invalid_invoice_status' });
        }
        row = {
          ...row,
          method: method && typeof method === 'string' && PAYMENT_METHODS.has(method) ? method : null,
          due_at: due,
          invoice_status: invStatus,
        };
      }

      const { data, error } = await supabase.from('personal_finance_entries').insert(row).select('id').single();
      if (error) return res.status(400).json({ ok: false, error: error.message });
      return res.json({ ok: true, id: data.id });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.get('/billing/personal-finance-entries', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const limit = Math.min(Number.parseInt(String(req.query.limit || ''), 10) || 100, 500);
      const kind = typeof req.query.entry_kind === 'string' ? req.query.entry_kind.trim() : '';
      let q = supabase.from('personal_finance_entries').select('*').order('created_at', { ascending: false }).limit(limit);
      if (kind === 'cash_received' || kind === 'invoice') {
        q = q.eq('entry_kind', kind);
      }
      const { data, error } = await q;
      if (error) return res.status(400).json({ ok: false, error: error.message });
      return res.json({ ok: true, rows: data ?? [] });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/billing/personal-finance-entries/:entryId/invoice-status', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const entryId = String(req.params.entryId || '').trim();
      const { status } = req.body || {};
      if (!entryId) return res.status(400).json({ ok: false, error: 'entry_id_required' });
      if (!status || typeof status !== 'string' || !['draft', 'sent', 'paid', 'void'].includes(status.trim())) {
        return res.status(400).json({ ok: false, error: 'invalid_status' });
      }
      const { data: row, error: findErr } = await supabase
        .from('personal_finance_entries')
        .select('id, entry_kind')
        .eq('id', entryId)
        .maybeSingle();
      if (findErr || !row) return res.status(404).json({ ok: false, error: 'entry_not_found' });
      if (row.entry_kind !== 'invoice') {
        return res.status(400).json({ ok: false, error: 'only_invoice_entries_support_status' });
      }
      const { error: uErr } = await supabase
        .from('personal_finance_entries')
        .update({ invoice_status: status.trim() })
        .eq('id', entryId);
      if (uErr) return res.status(400).json({ ok: false, error: uErr.message });
      return res.json({ ok: true, id: entryId, invoice_status: status.trim() });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
