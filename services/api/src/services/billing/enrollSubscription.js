import { BillingService } from './BillingService.js';

/**
 * Shared enrollment path used by POST /api/admin/billing/subscriptions and
 * the operator subscription-backfill CLI. Calls RPC `create_subscription`.
 *
 * Pass `create_initial_charge: false` for enrollment-only backfill (no charges).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   participant_id: string,
 *   plan_definition_id: string,
 *   starts_at?: string | null,
 *   ends_at?: string | null,
 *   account_id?: string | null,
 *   create_initial_charge?: boolean | null,
 *   notes?: string | null,
 *   created_by?: string | null,
 * }} input
 */
export async function enrollSubscription(supabase, input) {
  const participantId = String(input.participant_id || '').trim();
  const planDefinitionId = String(input.plan_definition_id || '').trim();
  const startsAt = input.starts_at || null;
  const endsAt = input.ends_at || null;
  const accountId = input.account_id || null;
  const notes = input.notes || null;
  const createdBy =
    typeof input.created_by === 'string' && input.created_by.trim()
      ? input.created_by.trim()
      : 'admin_api';

  const billingService = new BillingService(supabase);
  let shouldCreateInitialCharge;
  try {
    shouldCreateInitialCharge = await billingService.resolveInitialChargePreference(
      planDefinitionId,
      input.create_initial_charge,
    );
  } catch (error) {
    return { error, stage: 'plan_lookup', data: null, create_initial_charge: null };
  }

  const { data, error } = await supabase.rpc('create_subscription', {
    p_participant_id: participantId,
    p_plan_definition_id: planDefinitionId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_account_id: accountId,
    p_create_initial_charge: shouldCreateInitialCharge,
    p_notes: notes,
    p_created_by: createdBy,
  });

  if (error) return { error, stage: 'rpc', data: null, create_initial_charge: shouldCreateInitialCharge };
  return { data, error: null, stage: 'ok', create_initial_charge: shouldCreateInitialCharge };
}
