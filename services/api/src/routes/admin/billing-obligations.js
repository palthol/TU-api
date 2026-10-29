const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = value => typeof value === 'string' && UUID.test(value);
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

// Registered only on the staff-authenticated router (owner/finance writes).
export function registerBillingObligationRoutes(router, { supabase }) {
  function handler(run) {
    return async (req, res) => {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      try { return await run(req, res); }
      catch { return res.status(500).json({ ok: false, error: 'server_error' }); }
    };
  }
  const invalid = (res, error) => res.status(400).json({ ok: false, error });
  function result(res, data, error) {
    if (error) return res.status(error.code === '23505' ? 409 : 400).json({ ok: false, error: error.message });
    return res.json({ ok: true, obligation: data });
  }
  router.post('/billing/obligations/:id/entitlements', handler(async (req, res) => {
    const b = req.body ?? {};
    if (!isUuid(req.params.id)) return invalid(res, 'invalid_obligation_id');
    for (const field of ['id', 'participant_id', 'plan_definition_id']) {
      if (!isUuid(b[field])) return invalid(res, `invalid_${field}`);
    }
    if (b.replaces_subscription_id != null && !isUuid(b.replaces_subscription_id)) return invalid(res, 'invalid_replaces_subscription_id');
    if (Object.keys(b).some(k => !['id', 'participant_id', 'plan_definition_id', 'replaces_subscription_id'].includes(k))) return invalid(res, 'unsupported_entitlement_field');
    const { data, error } = await supabase.rpc('enroll_obligation_entitlement', {
      p_id: b.id, p_obligation_id: req.params.id, p_participant_id: b.participant_id,
      p_plan_definition_id: b.plan_definition_id, p_replaces_subscription_id: b.replaces_subscription_id ?? null,
    });
    if (error) return res.status(error.code === '23505' ? 409 : 400).json({ ok: false, error: error.message });
    return res.json({ ok: true, ...data });
  }));
  router.get('/billing/obligations', handler(async (req, res) => {
    if (!isUuid(req.query.account_id)) return invalid(res, 'invalid_account_id');
    const { data, error } = await supabase.from('billing_obligations')
      .select('*, billing_obligation_participants(participant_id)')
      .eq('account_id', req.query.account_id).order('created_at', { ascending: false });
    if (error) return invalid(res, error.message);
    return res.json({ ok: true, obligations: data ?? [] });
  }));
  router.post('/billing/obligations', handler(async (req, res) => {
    const b = req.body ?? {};
    if (!isUuid(b.id)) return invalid(res, 'invalid_obligation_id');
    if (!isUuid(b.account_id)) return invalid(res, 'invalid_account_id');
    if (typeof b.label !== 'string' || !b.label.trim() || b.label.trim().length > 200) return invalid(res, 'invalid_label');
    if (!Number.isInteger(b.amount_cents) || b.amount_cents <= 0 || b.amount_cents > 2147483647) return invalid(res, 'invalid_amount_cents');
    if (!isDate(b.anchor_date)) return invalid(res, 'invalid_anchor_date');
    if (b.participant_ids !== undefined && (!Array.isArray(b.participant_ids)
      || !b.participant_ids.every(isUuid) || new Set(b.participant_ids).size !== b.participant_ids.length)) return invalid(res, 'invalid_participant_ids');
    if (b.notes != null && typeof b.notes !== 'string') return invalid(res, 'invalid_notes');
    if (b.replaces_obligation_id != null && !isUuid(b.replaces_obligation_id)) return invalid(res, 'invalid_replaces_obligation_id');
    // Reject unsupported fields rather than silently accepting activation/terms.
    if (Object.keys(b).some(k => !['id', 'account_id', 'label', 'amount_cents', 'anchor_date', 'participant_ids', 'notes', 'replaces_obligation_id'].includes(k))) return invalid(res, 'unsupported_obligation_field');
    const { data, error } = await supabase.rpc('create_billing_obligation', {
      p_id: b.id, p_account_id: b.account_id, p_label: b.label.trim(), p_amount_cents: b.amount_cents,
      p_anchor_date: b.anchor_date, p_participant_ids: b.participant_ids ?? [], p_notes: b.notes ?? null,
      p_replaces_obligation_id: b.replaces_obligation_id ?? null,
    });
    return result(res, data, error);
  }));
  router.post('/billing/obligations/:id/transition', handler(async (req, res) => {
    const b = req.body ?? {};
    if (!isUuid(req.params.id)) return invalid(res, 'invalid_obligation_id');
    if (!['activate', 'pause', 'end'].includes(b.action)) return invalid(res, 'invalid_obligation_action');
    if (b.action === 'activate' && !isDate(b.billing_starts_on)) return invalid(res, 'invalid_billing_starts_on');
    if (Object.keys(b).some(k => !['action', 'billing_starts_on'].includes(k))
      || (b.action !== 'activate' && b.billing_starts_on !== undefined)) return invalid(res, 'unsupported_obligation_field');
    const { data, error } = await supabase.rpc('transition_billing_obligation', {
      p_id: req.params.id, p_action: b.action, p_billing_starts_on: b.billing_starts_on ?? null,
    });
    return result(res, data, error);
  }));
}
