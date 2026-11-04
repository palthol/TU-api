export function parseAllowedOriginsEnv(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw === '*') return { mode: 'any' };
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0 || origins.includes('*')) return { mode: 'any' };
  return { mode: 'list', origins };
}

export function normalizeOrigin(origin) {
  const raw = typeof origin === 'string' ? origin.trim() : '';
  return raw ? raw.toLowerCase() : '';
}

export function isOriginAllowed(origin, parsedAllowedOrigins) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (!parsedAllowedOrigins || parsedAllowedOrigins.mode !== 'list') return false;
  return parsedAllowedOrigins.origins.map(normalizeOrigin).includes(normalized);
}

