import { parseUuid } from '../../lib/adminRequestValidation.js';
import { sendDatabaseError } from '../../lib/exposeSupabaseError.js';
import { nyCalendarDate } from '../../lib/gymTime.js';
import { isCurrentlyEffective } from '../../lib/subscriptionCurrent.js';

const PLAN_COLUMNS = 'id, name, plan_category, billing_cadence, price_cents, is_active';
const CURRENT_SUBSCRIPTION_COLUMNS = `id, account_id, participant_id, status, starts_at, ends_at, created_at, plan_definitions(${PLAN_COLUMNS})`;

function handler(supabase, run) {
  return async (req, res) => {
    if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
    try {
      return await run(req, res);
    } catch {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  };
}

function publicPlan(row) {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  if (typeof row.plan_category !== 'string' || typeof row.billing_cadence !== 'string') return null;
  if (!Number.isInteger(row.price_cents) || row.price_cents < 0) return null;
  return {
    id: row.id,
    name: row.name,
    plan_category: row.plan_category,
    billing_cadence: row.billing_cadence,
    price_cents: row.price_cents,
    is_active: row.is_active === true,
  };
}

function nestedPlan(row) {
  const raw = row?.plan_definitions;
  const plan = Array.isArray(raw) ? raw[0] : raw;
  return publicPlan(plan);
}

/**
 * Read-only plan catalog and current-enrollment lookup.
 * Parent router must already run requireAdmin. GET is allowed for owner,
 * finance, and front_desk via the shared staff role matrix.
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient | null }} ctx
 */
export function registerBillingPlanRoutes(router, { supabase }) {
  router.get('/billing/plans', handler(supabase, async (_req, res) => {
    const { data, error } = await supabase
      .from('plan_definitions')
      .select(PLAN_COLUMNS)
      .eq('is_active', true)
      .order('plan_category', { ascending: true })
      .order('price_cents', { ascending: true })
      .order('name', { ascending: true });
    if (error) return sendDatabaseError(res, error, { context: 'billing.plans.list' });
    const plans = (data ?? []).map(publicPlan).filter((plan) => plan && plan.is_active);
    return res.json({ ok: true, plans });
  }));

  router.get('/billing/subscriptions/current', handler(supabase, async (req, res) => {
    const hasParticipant = req.query.participant_id != null && req.query.participant_id !== '';
    const hasAccount = req.query.account_id != null && req.query.account_id !== '';
    if (!hasParticipant && !hasAccount) {
      return res.status(400).json({ ok: false, error: 'participant_or_account_id_required' });
    }

    const participantId = hasParticipant ? parseUuid(req.query.participant_id) : null;
    if (hasParticipant && !participantId) {
      return res.status(400).json({ ok: false, error: 'invalid_participant_id' });
    }
    const accountId = hasAccount ? parseUuid(req.query.account_id) : null;
    if (hasAccount && !accountId) {
      return res.status(400).json({ ok: false, error: 'invalid_account_id' });
    }

    let query = supabase
      .from('subscriptions')
      .select(CURRENT_SUBSCRIPTION_COLUMNS)
      .eq('status', 'active');
    if (participantId) query = query.eq('participant_id', participantId);
    if (accountId) query = query.eq('account_id', accountId);
    const { data, error } = await query
      .order('starts_at', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) return sendDatabaseError(res, error, { context: 'billing.subscriptions.current' });

    const today = nyCalendarDate();
    const current = (data ?? []).find((row) => isCurrentlyEffective(row, today)) ?? null;
    return res.json({ ok: true, plan: current ? nestedPlan(current) : null });
  }));
}
