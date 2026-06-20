/** Slug -> exact Postgres view name (public schema) */
export const REPORTING_VIEWS = Object.freeze({
  'primary-kpis': 'view_analytics_primary_kpis_monthly',
  'payment-board': 'view_member_payment_board',
  'payment-reminders': 'view_member_payment_reminders',
  'orphan-waivers': 'view_orphan_waivers',
  'orphan-waiver-summary': 'view_orphan_waiver_summary',
  'charge-net': 'view_charge_net',
  'waiver-documents': 'view_waiver_documents',
  'participant-entitlements': 'participant_entitlement_status',
  'today-sessions': 'view_ops_today_sessions',
  'upcoming-access-issues': 'view_ops_upcoming_access_issues',
  'waiver-compliance-gaps': 'view_ops_waiver_compliance_gaps',
  'ar-aging': 'view_ops_ar_aging',
  'payment-risk': 'view_ops_unallocated_or_partial_payment_risk',
  'revenue-waterfall-monthly': 'view_analytics_revenue_waterfall_monthly',
  'subscription-movement': 'view_analytics_subscription_movement',
  'attendance-utilization-weekly': 'view_analytics_attendance_utilization_weekly',
  'entitlement-burn': 'view_analytics_entitlement_burn',
  'affiliate-performance': 'view_analytics_affiliate_program_performance',
  'data-hygiene': 'view_analytics_data_hygiene',
});

export const REPORTING_VIEW_CONFIG = Object.freeze({
  'primary-kpis': {
    dateColumn: 'month_start',
    defaultSort: 'month_start',
    sortableColumns: [
      'month_start',
      'expected_revenue_open_due_cents',
      'actual_revenue_net_cash_cents',
      'total_visitors_present_checkins',
      'current_monthly_members_active_count',
    ],
  },
  'payment-board': {
    dateColumn: 'next_due_date',
    defaultSort: 'days_late',
    sortableColumns: ['name', 'days_late', 'next_due_date', 'actual_price', 'base_price'],
  },
  'payment-reminders': {
    dateColumn: 'next_due_date',
    defaultSort: 'next_due_date',
    sortableColumns: ['name', 'days_late', 'next_due_date', 'actual_price', 'base_price', 'reminder_bucket'],
  },
  'orphan-waivers': {
    dateColumn: 'latest_waiver_at',
    defaultSort: 'latest_waiver_at',
    sortableColumns: ['full_name', 'email', 'waiver_count', 'latest_waiver_at', 'first_waiver_at'],
  },
  'orphan-waiver-summary': {
    dateColumn: null,
    defaultSort: null,
    sortableColumns: [],
  },
  'charge-net': {
    dateColumn: 'due_at',
    defaultSort: 'due_at',
    sortableColumns: ['due_at', 'gross_cents', 'credit_applied_cents', 'write_off_cents', 'net_due_cents'],
  },
  'waiver-documents': {
    dateColumn: 'signed_at_utc',
    defaultSort: 'signed_at_utc',
    sortableColumns: ['participant_full_name', 'signed_at_utc', 'audit_created_at'],
  },
  'participant-entitlements': {
    dateColumn: null,
    defaultSort: 'participant_id',
    sortableColumns: ['participant_id', 'scope', 'unit', 'remaining', 'has_availability', 'sessions_used', 'minutes_used'],
  },
  'today-sessions': {
    dateColumn: 'starts_at',
    defaultSort: 'starts_at',
    sortableColumns: ['starts_at', 'session_label', 'tracked_attendee_count', 'present_count', 'no_show_count', 'cancelled_count', 'filled_percent'],
  },
  'upcoming-access-issues': {
    dateColumn: 'next_session_starts_at',
    defaultSort: 'next_session_starts_at',
    sortableColumns: ['next_session_starts_at', 'participant_name', 'entitlement_remaining', 'has_availability', 'override_active', 'issue_reason'],
  },
  'waiver-compliance-gaps': {
    dateColumn: 'latest_waiver_at',
    defaultSort: 'participant_name',
    sortableColumns: ['participant_name', 'latest_waiver_at', 'waiver_count', 'emergency_contact_count', 'medical_history_count'],
  },
  'ar-aging': {
    dateColumn: null,
    defaultSort: 'total_outstanding_cents',
    sortableColumns: ['scope', 'open_item_count', 'total_outstanding_cents', 'bucket_0_30_cents', 'bucket_31_60_cents', 'bucket_61_90_cents', 'bucket_90_plus_cents'],
  },
  'payment-risk': {
    dateColumn: 'due_at',
    defaultSort: 'days_past_due',
    sortableColumns: ['risk_type', 'account_id', 'participant_id', 'gap_cents', 'days_past_due', 'due_at'],
  },
  'revenue-waterfall-monthly': {
    dateColumn: 'month_start',
    defaultSort: 'month_start',
    sortableColumns: ['month_start', 'gross_charged_cents', 'affiliate_credits_applied_cents', 'write_off_cents', 'net_billed_cents', 'collected_cents', 'refunded_cents', 'net_cash_collected_cents'],
    filters: {
      min_net_cash_cents: { column: 'net_cash_collected_cents', op: 'gte' },
      min_collected_cents: { column: 'collected_cents', op: 'gte' },
      max_refunded_cents: { column: 'refunded_cents', op: 'lte' },
    },
  },
  'subscription-movement': {
    dateColumn: 'month_start',
    defaultSort: 'month_start',
    sortableColumns: ['month_start', 'plan_name', 'billing_cadence', 'new_count', 'cancelled_count', 'paused_count', 'expired_count'],
  },
  'attendance-utilization-weekly': {
    dateColumn: 'week_start',
    defaultSort: 'week_start',
    sortableColumns: ['week_start', 'session_count', 'tracked_attendance_count', 'present_count', 'no_show_count', 'cancelled_count', 'unique_participants', 'private_minutes_used', 'no_show_rate_percent'],
  },
  'entitlement-burn': {
    dateColumn: null,
    defaultSort: 'usage_percent_of_limit',
    sortableColumns: ['participant_name', 'plan_name', 'scope', 'unit', 'entitlement_limit', 'used_quantity', 'remaining', 'usage_percent_of_limit', 'overburn_risk'],
  },
  'affiliate-performance': {
    dateColumn: 'last_credit_earned_at',
    defaultSort: 'outstanding_credit_liability_cents',
    sortableColumns: ['referrer_name', 'total_referral_count', 'active_referral_count', 'credits_earned_cents', 'credits_applied_cents', 'outstanding_credit_liability_cents', 'last_credit_earned_at'],
  },
  'data-hygiene': {
    dateColumn: 'created_at',
    defaultSort: 'hygiene_issue_score',
    sortableColumns: ['full_name', 'created_at', 'potential_duplicate_group_size', 'account_member_count', 'has_waiver_without_account_link', 'has_no_account_link', 'missing_email', 'missing_phone', 'hygiene_issue_score'],
  },
});
