const EVENT_NAME = 'waiver.submitted';

/**
 * Record the business-level waiver submission event used by API automations.
 * The database trigger still captures the lower-level waiver.created row event.
 */
export async function recordWaiverSubmittedEvent({
  supabase,
  waiverId,
  participantId,
  accountId = null,
  participant,
  submittedAt,
}) {
  if (!supabase) {
    throw new Error('supabase_not_configured');
  }
  if (!waiverId) {
    throw new Error('waiver_id_required');
  }

  const payload = {
    full_name: participant?.full_name ?? null,
    phone: participant?.phone ?? null,
    email: participant?.email ?? null,
    submitted_at: submittedAt ?? null,
  };

  const { data, error } = await supabase
    .from('event_ledger')
    .insert({
      event_name: EVENT_NAME,
      event_category: 'waiver',
      entity_type: 'waiver',
      entity_id: waiverId,
      participant_id: participantId ?? null,
      account_id: accountId,
      actor_type: 'service',
      source_system: 'api',
      payload_meta: {
        event_type: EVENT_NAME,
        entity_type: 'waiver',
        entity_id: waiverId,
        payload,
      },
    })
    .select('id, occurred_at')
    .single();

  if (error) {
    throw new Error(`event_ledger_insert_failed:${error.message}`);
  }

  return {
    id: data?.id ?? null,
    occurredAt: data?.occurred_at ?? null,
    eventName: EVENT_NAME,
  };
}
