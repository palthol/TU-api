/**
 * Admin billing routes (service-role Supabase RPCs).
 * All routes assume requireAdmin middleware (x-admin-key).
 */

/**
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient }} ctx
 */
export function registerAdminBillingRoutes(router, { supabase }) {
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
}
