import express from 'express';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import {
  readAdminEmailFromEnv,
  readAdminSessionFromRequest,
  readCookieValue,
  readSessionSecretFromEnv,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  ADMIN_SESSION_COOKIE_NAME,
} from '../../lib/adminSession.js';
import { isOriginAllowed, parseAllowedOriginsEnv } from '../../lib/allowedOrigins.js';

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function invalidCredentials(res) {
  return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password.' });
}

export function registerAuthRoutes(appInstance, options = {}) {
  const env = options.env || process.env;
  const sessionSecret = readSessionSecretFromEnv(env);
  const adminEmailResult = readAdminEmailFromEnv(env);

  if (!sessionSecret.ok) {
    console.warn('Auth routes disabled: SESSION_SECRET missing or too short');
    return false;
  }
  if (!adminEmailResult.ok) {
    console.warn('Auth routes disabled: ADMIN_EMAIL missing');
    return false;
  }

  const supabaseUrl = options.supabaseUrl || env.SUPABASE_URL;
  const supabaseAnonKey = options.supabaseAnonKey || env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Auth routes disabled: SUPABASE_URL or SUPABASE_ANON_KEY missing');
    return false;
  }

  const adminEmail = normalizeEmail(adminEmailResult.email);
  const allowedOrigins = parseAllowedOriginsEnv(env.ALLOWED_ORIGIN);

  const supabaseAuthClient =
    options.supabaseAuthClient ||
    createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

  const router = express.Router();
  const json = express.json({ limit: '10kb' });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post('/login', loginLimiter, json, async (req, res) => {
    try {
      const email = normalizeEmail(req?.body?.email);
      const password = typeof req?.body?.password === 'string' ? req.body.password : '';
      if (!email || !password) return invalidCredentials(res);

      const { data, error } = await supabaseAuthClient.auth.signInWithPassword({ email, password });
      if (error) return invalidCredentials(res);

      const authedEmail = normalizeEmail(data?.user?.email || data?.session?.user?.email);
      if (!authedEmail) return invalidCredentials(res);
      if (authedEmail !== adminEmail) return invalidCredentials(res);

      await setAdminSessionCookie(res, { email: authedEmail }, env);
      return res.status(200).json({ email: authedEmail });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('auth.login.error', { message });
      return invalidCredentials(res);
    }
  });

  router.get('/me', async (req, res) => {
    const session = await readAdminSessionFromRequest(req, env);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    if (normalizeEmail(session.email) !== adminEmail) {
      clearAdminSessionCookie(res, env);
      return res.status(401).json({ error: 'unauthorized' });
    }
    await setAdminSessionCookie(res, { email: session.email }, env);
    return res.status(200).json({ email: session.email });
  });

  router.post('/logout', async (req, res) => {
    const token = readCookieValue(req?.headers?.cookie, ADMIN_SESSION_COOKIE_NAME);
    if (token) {
      const origin = req.header('origin');
      if (!isOriginAllowed(origin, allowedOrigins)) {
        return res.status(403).json({ error: 'csrf_failed' });
      }
    }
    clearAdminSessionCookie(res, env);
    return res.status(204).end();
  });

  appInstance.use('/api/auth', router);
  return true;
}

