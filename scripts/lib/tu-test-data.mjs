/**
 * Convention for disposable integration-test data (finance, schedule, waivers).
 *
 * 1) Participants created by tu-test-seed use email addresses ending in
 *    `@tu-test.invalid` (IANA reserved-style; not deliverable). Only those rows
 *    are targeted by tu-test-cleanup.
 * 2) personal_finance_entries without a participant link use member_display_name
 *    prefixed with `[TU-TEST]` and/or notes containing `tu-test-run:`.
 *
 * event_ledger rows are append-only and are NOT deleted; they may reference
 * removed entity UUIDs as historical audit noise.
 */

export const TU_TEST_EMAIL_DOMAIN = 'tu-test.invalid';

/** @param {string} runId */
export function tuTestEmail(runId) {
  return `tu-test-${runId}@${TU_TEST_EMAIL_DOMAIN}`;
}

export const TU_TEST_DISPLAY_PREFIX = '[TU-TEST]';

/** @param {string} runId @param {string} [label] */
export function tuTestDisplayName(runId, label = 'Member') {
  return `${TU_TEST_DISPLAY_PREFIX} ${label} (${runId})`;
}

/** @param {string} runId */
export function tuTestRunNote(runId) {
  return `tu-test-run:${runId}`;
}

export function assertTuTestEmail(email) {
  if (!String(email).toLowerCase().endsWith(`@${TU_TEST_EMAIL_DOMAIN}`)) {
    throw new Error(`Refusing non-test email (must end with @${TU_TEST_EMAIL_DOMAIN}): ${email}`);
  }
}
