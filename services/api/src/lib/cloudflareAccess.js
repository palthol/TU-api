import * as jose from 'jose';

const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';

let remoteJwks = null;
let remoteJwksTeamDomain = null;

function normalizeTeamDomain(raw) {
  const trimmed = String(raw || '').trim().replace(/\/$/, '');
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}

export function isCloudflareAccessConfigured() {
  return Boolean(normalizeTeamDomain(process.env.CF_ACCESS_TEAM_DOMAIN) && String(process.env.CF_ACCESS_AUD || '').trim());
}

export function isViewerDevBypassEnabled() {
  if (isCloudflareAccessConfigured()) return false;
  return String(process.env.WAIVER_VIEWER_DEV_BYPASS || '').trim().toLowerCase() === 'true';
}

export function parseViewerEmailAllowlist(raw = process.env.WAIVER_VIEWER_ALLOWED_EMAILS) {
  return String(raw || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function getRemoteJwks(teamDomain) {
  if (remoteJwks && remoteJwksTeamDomain === teamDomain) return remoteJwks;
  const certsUrl = new URL('/cdn-cgi/access/certs', teamDomain);
  remoteJwks = jose.createRemoteJWKSet(certsUrl);
  remoteJwksTeamDomain = teamDomain;
  return remoteJwks;
}

export async function verifyCloudflareAccessJwt(token) {
  const teamDomain = normalizeTeamDomain(process.env.CF_ACCESS_TEAM_DOMAIN);
  const audience = String(process.env.CF_ACCESS_AUD || '').trim();
  if (!teamDomain || !audience) {
    throw new Error('cloudflare_access_not_configured');
  }
  if (!token || typeof token !== 'string') {
    throw new Error('missing_access_jwt');
  }

  const jwks = getRemoteJwks(teamDomain);
  const { payload } = await jose.jwtVerify(token, jwks, {
    issuer: teamDomain,
    audience,
  });
  return payload;
}

export function isEmailAllowedForViewer(email, allowlist = parseViewerEmailAllowlist()) {
  if (!allowlist.length) return false;
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  return allowlist.includes(normalized);
}

/**
 * Protects waiver-viewer routes.
 * - Production: requires Cloudflare Access JWT + email allowlist.
 * - Local dev: set WAIVER_VIEWER_DEV_BYPASS=true when CF Access is not configured.
 */
export function createRequireViewerAccess() {
  return async function requireViewerAccess(req, res, next) {
    try {
      if (isViewerDevBypassEnabled()) {
        req.viewerIdentity = { email: 'dev-bypass@local', source: 'dev_bypass' };
        return next();
      }

      if (!isCloudflareAccessConfigured()) {
        return res.status(503).json({
          ok: false,
          error: 'viewer_access_not_configured',
          hint: 'Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, or WAIVER_VIEWER_DEV_BYPASS=true for local development.',
        });
      }

      const allowlist = parseViewerEmailAllowlist();
      if (!allowlist.length) {
        return res.status(503).json({
          ok: false,
          error: 'viewer_allowlist_not_configured',
          hint: 'Set WAIVER_VIEWER_ALLOWED_EMAILS to your email address.',
        });
      }

      const token = req.header(ACCESS_JWT_HEADER);
      const payload = await verifyCloudflareAccessJwt(token);
      const email = payload.email || payload.common_name;
      if (!isEmailAllowedForViewer(email, allowlist)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }

      req.viewerIdentity = {
        email: String(email || '').trim(),
        sub: payload.sub,
        source: 'cloudflare_access',
      };
      return next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('viewer.access.denied', { message });
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  };
}
