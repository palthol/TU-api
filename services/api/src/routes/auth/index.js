import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import {
  ADMIN_SESSION_COOKIE_NAME,
  readAdminEmailFromEnv,
  readAdminSessionFromRequest,
  readCookieValueStrict,
  readSessionSecretFromEnv,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  clearLegacyAdminSessionCookie,
} from '../../lib/adminSession.js';
import { isOriginAllowed, parseAdminAllowedOriginsEnv } from '../../lib/allowedOrigins.js';
import { readSupabasePublishableKey } from '../../lib/readSupabasePublishableKey.js';

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function invalidCredentials(res) {
  return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password.' });
}

function rateLimited(res) {
  return res.status(429).json({ error: 'rate_limited' });
}

function serviceUnavailable(res) {
  return res.status(503).json({ error: 'service_unavailable' });
}

function readAdminUserIdFromEnv(env) {
  const raw = typeof env.ADMIN_USER_ID === 'string' ? env.ADMIN_USER_ID : '';
  const id = raw.trim();
  return id ? id : null;
}

function isConfirmedUser(user) {
  const emailConfirmedAt = user?.email_confirmed_at ?? user?.confirmed_at;
  return typeof emailConfirmedAt === 'string' && emailConfirmedAt.trim().length > 0;
}

function jsonBodyErrorHandler(err, _req, res, next) {
  const status = err?.status || err?.statusCode;
  if (err?.type === 'entity.too.large' || status === 413) {
    return res.status(413).json({ error: 'payload_too_large' });
  }
  if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && status === 400)) {
    return res.status(400).json({ error: 'invalid_json' });
  }
  return next(err);
}

export function registerAuthRoutes(appInstance, options = {}) {
  const env = options.env || process.env;
  const sessionSecret = readSessionSecretFromEnv(env);
  const adminEmailResult = readAdminEmailFromEnv(env);
  const adminUserId = readAdminUserIdFromEnv(env);

  if (!sessionSecret.ok) {
    console.warn('Auth routes disabled: SESSION_SECRET missing or too short');
    return false;
  }
  if (!adminEmailResult.ok) {
    console.warn('Auth routes disabled: ADMIN_EMAIL missing');
    return false;
  }
  if (!adminUserId) {
    console.warn('Auth routes disabled: ADMIN_USER_ID missing');
    return false;
  }

  const supabaseUrl = options.supabaseUrl || env.SUPABASE_URL;
  // options.supabaseAnonKey is an explicit test override. Production reads env.
  const injectedPublishableKey = typeof options.supabaseAnonKey === 'string' ? options.supabaseAnonKey.trim() : '';
  const supabaseAnonKey = injectedPublishableKey || readSupabasePublishableKey(env);
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
      'Auth routes disabled: SUPABASE_URL missing, or both SUPABASE_PUBLISHABLE_KEY and SUPABASE_ANON_KEY are unset',
    );
    return false;
  }

  const adminEmail = normalizeEmail(adminEmailResult.email);
  const adminAllowedOrigins = parseAdminAllowedOriginsEnv(env.ADMIN_ALLOWED_ORIGINS);
  const createSupabaseAuthClient =
    options.createSupabaseAuthClient ||
    (() =>
      createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }));

  const router = express.Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    return next();
  });

  const loginPerIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    identifier: 'admin_login_ip',
    keyGenerator(req) {
      return ipKeyGenerator(req.ip || '0.0.0.0');
    },
    handler(_req, res) {
      rateLimited(res);
    },
  });

  const loginGlobalLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    identifier: 'admin_login_global',
    keyGenerator() {
      return 'global';
    },
    handler(_req, res) {
      rateLimited(res);
    },
  });

  const json = express.json({ limit: '10kb' });

  router.post('/login', loginGlobalLimiter, loginPerIpLimiter, json, jsonBodyErrorHandler, async (req, res) => {
    const supabaseAuthClient = createSupabaseAuthClient();
    try {
      const email = normalizeEmail(req?.body?.email);
      const password = typeof req?.body?.password === 'string' ? req.body.password : '';
      if (!email || !password) return invalidCredentials(res);

      let signInResult;
      try {
        signInResult = await supabaseAuthClient.auth.signInWithPassword({ email, password });
      } catch (error) {
        const status = Number(error?.status || 0);
        if (status === 429) return rateLimited(res);
        const message = error instanceof Error ? error.message : String(error);
        console.error('auth.login.supabase_unreachable', { message });
        return serviceUnavailable(res);
      }

      const { data, error } = signInResult || {};
      if (error) {
        const status = Number(error.status || 0);
        if (status === 429) return rateLimited(res);
        if (status >= 500) return serviceUnavailable(res);
        return invalidCredentials(res);
      }

      const user = data?.user || data?.session?.user;
      const authedEmail = normalizeEmail(user?.email);
      if (!authedEmail) return invalidCredentials(res);
      if (authedEmail !== adminEmail) return invalidCredentials(res);
      if (String(user?.id || '') !== adminUserId) return invalidCredentials(res);
      if (!isConfirmedUser(user)) return invalidCredentials(res);

      await setAdminSessionCookie(res, { email: authedEmail, authTimeSec: Math.floor(Date.now() / 1000) }, env);
      return res.status(200).json({ email: authedEmail });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('auth.login.error', { message });
      return serviceUnavailable(res);
    } finally {
      try {
        await supabaseAuthClient.auth.signOut({ scope: 'local' });
      } catch {
        // ignore
      }
    }
  });

  router.get('/me', async (req, res) => {
    const sessionResult = await readAdminSessionFromRequest(req, env);
    if (!sessionResult.ok) return res.status(401).json({ error: 'unauthorized' });
    const { session } = sessionResult;
    if (normalizeEmail(session.email) !== adminEmail) {
      clearAdminSessionCookie(res, env);
      return res.status(401).json({ error: 'unauthorized' });
    }
    await setAdminSessionCookie(res, { email: session.email, authTimeSec: session.authTime }, env);
    return res.status(200).json({ email: session.email });
  });

  router.post('/logout', async (req, res) => {
    const cookie = readCookieValueStrict(req?.headers?.cookie, ADMIN_SESSION_COOKIE_NAME);
    if (cookie.reason !== 'missing') {
      const origin = req.header('origin');
      if (!isOriginAllowed(origin, adminAllowedOrigins)) {
        return res.status(403).json({ error: 'csrf_failed' });
      }
    }
    if (cookie.reason === 'duplicate') {
      return res.status(401).json({ error: 'unauthorized' });
    }
    clearAdminSessionCookie(res, env);
    clearLegacyAdminSessionCookie(res);
    return res.status(204).end();
  });

  router.use(jsonBodyErrorHandler);

  appInstance.use('/api/auth', router);
  return true;
}

