/**
 * Current / overlapping subscription window rules.
 * Dates are ISO calendar dates (YYYY-MM-DD). `ends_at` is inclusive.
 * "Today" for operator tooling is America/New_York, same as GET /billing/subscriptions/current.
 */

export function isCurrentlyEffective(subscription, today) {
  if (!subscription || subscription.status !== 'active') return false;
  if (typeof subscription.starts_at !== 'string' || subscription.starts_at > today) return false;
  if (subscription.ends_at != null && subscription.ends_at < today) return false;
  return true;
}

export function subscriptionRangeOverlaps(subscription, startDate, endDate = null) {
  if (!subscription || subscription.status !== 'active') return false;
  if (typeof subscription.starts_at !== 'string') return false;
  const existingEnd = subscription.ends_at == null ? '9999-12-31' : subscription.ends_at;
  const proposedEnd = endDate == null ? '9999-12-31' : endDate;
  return subscription.starts_at <= proposedEnd && startDate <= existingEnd;
}
