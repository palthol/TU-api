/**
 * Optional DB error detail for JSON responses (never in production unless opted in).
 */
export function exposeSupabaseError(error) {
  if (process.env.NODE_ENV === 'production' && process.env.API_EXPOSE_DB_ERRORS !== 'true') {
    return undefined;
  }
  if (!error || typeof error !== 'object') return undefined;
  return {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  };
}
