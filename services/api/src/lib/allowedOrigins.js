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

export function parseAdminAllowedOriginsEnv(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw === '*') return { mode: 'none', origins: [] };
  const parsed = parseAllowedOriginsEnv(raw);
  if (parsed.mode !== 'list') return { mode: 'none', origins: [] };
  return parsed;
}

export function normalizeOriginForCompare(origin) {
  const raw = typeof origin === 'string' ? origin.trim() : '';
  if (!raw) return null;
  if (raw.toLowerCase() === 'null') return null;
  if (raw.endsWith('/')) return null;
  return raw;
}

export function isOriginAllowed(origin, parsedAllowedOrigins) {
  const normalized = normalizeOriginForCompare(origin);
  if (!normalized) return false;
  if (!parsedAllowedOrigins || parsedAllowedOrigins.mode !== 'list') return false;
  for (const candidate of parsedAllowedOrigins.origins) {
    const normalizedCandidate = normalizeOriginForCompare(candidate);
    if (!normalizedCandidate) continue;
    if (normalizedCandidate === normalized) return true;
  }
  return false;
}

