export class BillingService {
  constructor(supabase) {
    this.supabase = supabase;
  }

  async generateDueCharges() {
    const { data, error } = await this.supabase.rpc('generate_monthly_charges');
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async resolveInitialChargePreference(planDefinitionId, requestedPreference) {
    if (typeof requestedPreference === 'boolean') return requestedPreference;

    const { data, error } = await this.supabase
      .from('plan_definitions')
      .select('billing_cadence, price_cents')
      .eq('id', planDefinitionId)
      .maybeSingle();

    if (error) throw error;
    return data?.billing_cadence === 'monthly' && Number(data.price_cents) > 0;
  }
}
