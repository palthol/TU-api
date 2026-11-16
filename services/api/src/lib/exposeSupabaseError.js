/**
 * Map Postgres / PostgREST errors to stable client machine keys.
 * Never return error.message, details, or hint to clients.
 */

export const DATABASE_ERROR_KEYS = Object.freeze({
  RELATED_RECORD_NOT_FOUND: 'related_record_not_found',
  ALREADY_EXISTS: 'already_exists',
  INVALID_INPUT: 'invalid_input',
  NOT_FOUND: 'not_found',
  INTERNAL_ERROR: 'internal_error',
});

const STABLE_MACHINE_KEY_RE = /^[a-z][a-z0-9_]{1,80}$/;

const CODE_MAP = Object.freeze({
  '23503': { status: 400, error: DATABASE_ERROR_KEYS.RELATED_RECORD_NOT_FOUND },
  '23505': { status: 409, error: DATABASE_ERROR_KEYS.ALREADY_EXISTS },
  '23514': { status: 400, error: DATABASE_ERROR_KEYS.INVALID_INPUT },
  '22P02': { status: 400, error: DATABASE_ERROR_KEYS.INVALID_INPUT },
  '23502': { status: 400, error: DATABASE_ERROR_KEYS.INVALID_INPUT },
  PGRST116: { status: 404, error: DATABASE_ERROR_KEYS.NOT_FOUND },
});

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isStableMachineKey(value) {
  return typeof value === 'string' && STABLE_MACHINE_KEY_RE.test(value);
}

/**
 * Redact JWT-shaped strings before server-side logging.
 * @param {unknown} value
 */
function redactSecrets(value) {
  return String(value ?? '').replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+/g, '[redacted]');
}

/**
 * Log a database error without writing secrets or client-facing payloads.
 * @param {string} context
 * @param {unknown} error
 */
export function logDatabaseError(context, error) {
  const err = error && typeof error === 'object' ? error : {};
  console.error(context || 'database', {
    code: redactSecrets(err.code),
    message: redactSecrets(err.message),
  });
}

/**
 * @param {string} key
 */
const MACHINE_KEY_STATUS = Object.freeze({
  not_found: 404,
  template_not_found: 404,
  class_type_not_found: 404,
  class_not_found: 404,
  instructor_not_found: 404,
  session_not_found: 404,
  content_not_found: 404,
  booking_not_found: 404,
  participant_not_found: 404,
  receipt_not_found: 404,
  entry_not_found: 404,
  payment_refund_not_found: 404,
  unauthorized_member: 401,
  already_exists: 409,
  email_taken: 409,
  last_owner: 409,
  idempotency_key_conflict: 409,
  session_full: 409,
  booking_closed: 409,
  no_credit: 409,
  late_cancel: 409,
  already_booked: 409,
  not_booked: 409,
  capacity_not_configured: 400,
});

function statusForMachineKey(key) {
  return MACHINE_KEY_STATUS[key] ?? 400;
}

/**
 * @param {unknown} error
 */
function readErrorCode(error) {
  if (!error || typeof error !== 'object') return '';
  return String(error.code || '').trim();
}

/**
 * @param {unknown} error
 */
function readErrorMessage(error) {
  if (!error || typeof error !== 'object') return '';
  return String(error.message || '').trim();
}

/**
 * @typedef {{
 *   context?: string,
 *   alreadyExistsKey?: string,
 *   relatedRecordStatus?: number,
 *   fallbackKey?: string,
 *   fallbackStatus?: number,
 *   extra?: Record<string, unknown>,
 *   log?: boolean,
 * }} DatabaseErrorOptions
 */

/**
 * Map a Supabase / Postgres / PostgREST error to `{ status, body }`.
 * Route-specific snake_case keys already present on `error.message` are kept
 * when the code is not a known constraint/input code.
 *
 * @param {unknown} error
 * @param {DatabaseErrorOptions} [options]
 * @returns {{ status: number, body: { ok: false, error: string } & Record<string, unknown> }}
 */
export function mapDatabaseError(error, options = {}) {
  const {
    context = 'database',
    alreadyExistsKey = DATABASE_ERROR_KEYS.ALREADY_EXISTS,
    relatedRecordStatus = 400,
    fallbackKey = DATABASE_ERROR_KEYS.INTERNAL_ERROR,
    fallbackStatus = 500,
    extra = {},
    log = true,
  } = options;

  if (log) logDatabaseError(context, error);

  const code = readErrorCode(error);
  const mapped = CODE_MAP[code];
  if (mapped) {
    let status = mapped.status;
    let key = mapped.error;
    if (code === '23503') {
      status = relatedRecordStatus === 404 ? 404 : 400;
      key = DATABASE_ERROR_KEYS.RELATED_RECORD_NOT_FOUND;
    }
    if (code === '23505') {
      key = isStableMachineKey(alreadyExistsKey)
        ? alreadyExistsKey
        : DATABASE_ERROR_KEYS.ALREADY_EXISTS;
    }
    return { status, body: { ok: false, error: key, ...extra } };
  }

  const message = readErrorMessage(error);
  if (isStableMachineKey(message)) {
    return {
      status: statusForMachineKey(message),
      body: { ok: false, error: message, ...extra },
    };
  }

  return {
    status: fallbackStatus,
    body: { ok: false, error: fallbackKey, ...extra },
  };
}

/**
 * Send a mapped database error. Never includes message/details/hint.
 * @param {import('express').Response} res
 * @param {unknown} error
 * @param {DatabaseErrorOptions} [options]
 */
export function sendDatabaseError(res, error, options = {}) {
  const mapped = mapDatabaseError(error, options);
  return res.status(mapped.status).json(mapped.body);
}

/**
 * Previously attached raw DB fields to JSON in non-production. That leaked
 * table/constraint names. Always omit message/details/hint from clients.
 * @param {unknown} _error
 * @returns {undefined}
 */
export function exposeSupabaseError(_error) {
  return undefined;
}
