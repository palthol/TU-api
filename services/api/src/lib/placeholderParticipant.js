import { parseIsoDate, parseUuid } from './adminRequestValidation.js';

export const PLACEHOLDER_DATE_OF_BIRTH = '1900-01-01';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MIN = 2;
const NAME_MAX = 80;
const REASON_MAX = 500;
const PHONE_MAX = 40;

function trimName(value, errorKey) {
  if (typeof value !== 'string') return { ok: false, error: errorKey };
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
    return { ok: false, error: errorKey };
  }
  return { ok: true, value: trimmed };
}

function optionalTrimmed(value, errorKey, maxLen) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: errorKey };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > maxLen) return { ok: false, error: errorKey };
  return { ok: true, value: trimmed };
}

function requiredReason(value, errorKey) {
  if (typeof value !== 'string') return { ok: false, error: errorKey };
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > REASON_MAX) return { ok: false, error: errorKey };
  return { ok: true, value: trimmed };
}

function optionalBoolean(value, errorKey) {
  if (value === undefined) return { ok: true, value: false };
  if (typeof value !== 'boolean') return { ok: false, error: errorKey };
  return { ok: true, value };
}

/**
 * Validate POST /api/admin/participants/placeholders.
 * @param {unknown} body
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function parsePlaceholderCreateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_body' };
  }

  const first = trimName(body.first_name, 'invalid_first_name');
  if (!first.ok) return first;
  const last = trimName(body.last_name, 'invalid_last_name');
  if (!last.ok) return last;

  const reason = requiredReason(body.placeholder_reason, 'placeholder_reason_required');
  if (!reason.ok) return reason;

  const email = optionalTrimmed(body.email, 'invalid_email', 320);
  if (!email.ok) return email;
  if (email.value && !EMAIL_RE.test(email.value)) {
    return { ok: false, error: 'invalid_email' };
  }

  const phone = optionalTrimmed(body.phone, 'invalid_phone', PHONE_MAX);
  if (!phone.ok) return phone;

  const dobFlag = optionalBoolean(body.dob_is_placeholder, 'invalid_dob_is_placeholder');
  if (!dobFlag.ok) return dobFlag;

  const hasDob = body.date_of_birth !== undefined && body.date_of_birth !== null && body.date_of_birth !== '';
  let dateOfBirth = null;
  if (hasDob) {
    dateOfBirth = parseIsoDate(body.date_of_birth);
    if (!dateOfBirth) return { ok: false, error: 'invalid_date_of_birth' };
  }

  const dobReasonRaw = optionalTrimmed(
    body.dob_placeholder_reason,
    'dob_placeholder_reason_required',
    REASON_MAX,
  );
  if (!dobReasonRaw.ok) return dobReasonRaw;

  if (dobFlag.value) {
    if (!dobReasonRaw.value) return { ok: false, error: 'dob_placeholder_reason_required' };
    if (!dateOfBirth) dateOfBirth = PLACEHOLDER_DATE_OF_BIRTH;
  } else {
    if (!dateOfBirth) return { ok: false, error: 'date_of_birth_required' };
    if (dateOfBirth === PLACEHOLDER_DATE_OF_BIRTH) {
      return { ok: false, error: 'dob_is_placeholder_required' };
    }
  }

  const hasAccountId = body.account_id !== undefined && body.account_id !== null && body.account_id !== '';
  const hasAccountName =
    body.account_name !== undefined && body.account_name !== null && body.account_name !== '';
  if (hasAccountId && hasAccountName) {
    return { ok: false, error: 'account_id_xor_account_name' };
  }

  let accountId = null;
  if (hasAccountId) {
    accountId = parseUuid(body.account_id);
    if (!accountId) return { ok: false, error: 'invalid_account_id' };
  }

  const accountName = optionalTrimmed(body.account_name, 'invalid_account_name', 200);
  if (!accountName.ok) return accountName;

  const hasPlan = body.plan_id !== undefined && body.plan_id !== null && body.plan_id !== '';
  let planId = null;
  if (hasPlan) {
    planId = parseUuid(body.plan_id);
    if (!planId) return { ok: false, error: 'invalid_plan_id' };
  }

  const hasStart = body.start_date !== undefined && body.start_date !== null && body.start_date !== '';
  let startDate = null;
  if (hasStart) {
    if (!planId) return { ok: false, error: 'plan_id_required' };
    startDate = parseIsoDate(body.start_date);
    if (!startDate) return { ok: false, error: 'invalid_start_date' };
  }

  return {
    ok: true,
    value: {
      first_name: first.value,
      last_name: last.value,
      placeholder_reason: reason.value,
      email: email.value,
      phone: phone.value,
      date_of_birth: dateOfBirth,
      dob_is_placeholder: dobFlag.value,
      dob_placeholder_reason: dobFlag.value ? dobReasonRaw.value : null,
      account_id: accountId,
      account_name: accountName.value,
      plan_id: planId,
      start_date: startDate,
    },
  };
}

export function publicPlaceholderParticipant(row) {
  if (!row || typeof row !== 'object') return null;
  const participant = row.participant && typeof row.participant === 'object' ? row.participant : row;
  if (typeof participant.id !== 'string') return null;
  return {
    id: participant.id,
    first_name: participant.first_name ?? '',
    last_name: participant.last_name ?? '',
    is_placeholder: participant.is_placeholder === true,
    placeholder_reason: participant.placeholder_reason ?? null,
    dob_is_placeholder: participant.dob_is_placeholder === true,
  };
}

export function publicPlaceholderSubscription(row) {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.id !== 'string') return null;
  return {
    id: row.id,
    plan_id: row.plan_id ?? null,
    status: row.status ?? 'active',
    start_date: row.start_date ?? null,
  };
}
