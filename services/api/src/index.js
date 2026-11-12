import 'dotenv/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { createWaiverPdfRouter } from './routes/waivers/pdf.js';
import { registerWaiverSubmitRoute } from './services/accounts/submitWaiver.js';
import { registerAdminBillingCronRoutes, registerAdminBillingRoutes } from './routes/admin/billing.js';
import { registerAdminParticipantRoutes } from './routes/admin/participants.js';
import { registerAdminReportingRoutes } from './routes/admin/reporting.js';
import { registerAdminNotificationRoutes } from './routes/admin/notifications.js';
import { registerAdminWaiverRoutes } from './routes/admin/waivers.js';
import { createRequireViewerAccess } from './lib/cloudflareAccess.js';
import { registerViewerWaiverRoutes } from './routes/viewer/waivers.js';
import { readSupabaseSecretKey } from './lib/readSupabaseSecretKey.js';
import { warnIfSupabaseKeyIsNotServiceRole } from './lib/warnIfSupabaseKeyIsNotServiceRole.js';
import { createRequireAdminFromSupabase } from './lib/requireAdmin.js';
import { createRequireAdminOrCron } from './lib/requireAdminOrCron.js';
import { createSupabaseAuditWriter } from './lib/staffAuth.js';
import { registerStaffAuthRoutes } from './lib/staffRoutes.js';
import { registerAdminSchedulingRoutes } from './routes/admin/scheduling.js';
import { registerStripeWebhookRoute } from './routes/webhooks/stripe.js';
import { createAdminSchedulingV2Router } from './routes/scheduling/index.js';
import { createMemberRouter } from './routes/member/index.js';
import { createCalendarRouter } from './routes/calendar/index.js';
import { registerAuthRoutes } from './routes/auth/index.js';
import {
  createPublicPostMiddleware,
  jsonPayloadTooLargeHandler,
  jsonUnhandledErrorHandler,
  parseTrustProxy,
  readPublicPostLimitsFromEnv,
} from './lib/publicPostGuard.js';
import { isOriginAllowed, parseAdminAllowedOriginsEnv, parseAllowedOriginsEnv } from './lib/allowedOrigins.js';

const app = express();
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
app.use((_req, res, next) => {
  res.vary('Origin');
  return next();
});

export { parseAllowedOriginsEnv };

export function registerCors(appInstance, allowedOriginsEnvValue = process.env.ALLOWED_ORIGIN) {
  appInstance.use((_req, res, next) => {
    res.vary('Origin');
    return next();
  });

  const publicParsed = parseAllowedOriginsEnv(allowedOriginsEnvValue);
  const adminParsed = parseAdminAllowedOriginsEnv(process.env.ADMIN_ALLOWED_ORIGINS);

  const allowAnyPublic = cors();
  const adminAllowlisted = new Map();
  const publicAllowlisted = new Map();

  const middleware =
    publicParsed.mode === 'any' && adminParsed.mode !== 'list'
      ? allowAnyPublic
      : (req, res, next) => {
          const origin = req.header('origin');
          if (!origin) return next();

          if (isOriginAllowed(origin, adminParsed)) {
            let mw = adminAllowlisted.get(origin);
            if (!mw) {
              mw = cors({ origin, credentials: true });
              adminAllowlisted.set(origin, mw);
            }
            return mw(req, res, next);
          }

          if (publicParsed.mode === 'any') {
            return allowAnyPublic(req, res, next);
          }

          if (isOriginAllowed(origin, publicParsed)) {
            let mw = publicAllowlisted.get(origin);
            if (!mw) {
              mw = cors({ origin });
              publicAllowlisted.set(origin, mw);
            }
            return mw(req, res, next);
          }

          return next();
        };
  appInstance.use(middleware);
  // Express 5 / path-to-regexp v8: unnamed `*` is invalid. `/{*splat}` is the
  // Express 4 `app.options('*')` equivalent (matches `/` and every subpath).
  appInstance.options('/{*splat}', middleware);
}

registerCors(app);

const PORT = process.env.PORT || 3001;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRole = readSupabaseSecretKey();
const supabase = supabaseUrl && supabaseServiceRole ? createClient(supabaseUrl, supabaseServiceRole) : null;
if (supabaseServiceRole) warnIfSupabaseKeyIsNotServiceRole(supabaseServiceRole);

// Raw body required for Stripe-Signature verify. Must run before express.json().
registerStripeWebhookRoute(app, { supabase });

const requireAdmin = createRequireAdminFromSupabase(supabase);
const requireAdminOrCron = createRequireAdminOrCron(requireAdmin, { writeAudit: createSupabaseAuditWriter(supabase) });
const SIGNATURES_BUCKET = process.env.SIGNATURES_BUCKET || 'signatures';
const WAIVERS_BUCKET = process.env.WAIVERS_BUCKET || 'signed-waivers';
const publicPostLimits = readPublicPostLimitsFromEnv(process.env);

const splitStorageObjectPath = (value) => {
  const [bucket, ...keyParts] = String(value || '').split('/');
  const key = keyParts.join('/');
  if (!bucket || !key) return null;
  return { bucket, key };
};

const GOALS = new Set(['first-class', 'fitness-confidence', 'competition', 'weight-management', 'youth-inquiry']);

function normalizeLeadPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length !== 10) return null;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function parseLeadBody(body) {
  if (!body || typeof body !== 'object') return { error: 'invalid_body' };
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
  if (firstName.length < 2) return { error: 'invalid_first_name' };
  if (lastName.length < 2) return { error: 'invalid_last_name' };
  const email =
    typeof body.email === 'string' && body.email.trim().length
      ? body.email.trim()
      : null;
  const phoneRaw =
    typeof body.phone === 'string' && body.phone.trim().length ? body.phone.trim() : null;
  const phone = phoneRaw ? normalizeLeadPhone(phoneRaw) : null;
  if (phoneRaw && !phone) return { error: 'invalid_phone' };
  if (!email && !phone) return { error: 'email_or_phone_required' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'invalid_email' };
  const goals = typeof body.goals === 'string' ? body.goals : '';
  if (!GOALS.has(goals)) return { error: 'invalid_goals' };
  const preferredTime =
    typeof body.preferredTime === 'string' ? body.preferredTime.trim() : '';
  if (preferredTime.length < 2) return { error: 'invalid_preferred_time' };
  let notes = null;
  if (body.notes != null) {
    if (typeof body.notes !== 'string') return { error: 'invalid_notes' };
    notes = body.notes.slice(0, 500);
  }
  return {
    payload: {
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      goals,
      preferred_time: preferredTime,
      notes,
      source: 'marketing_contact',
    },
  };
}

app.post(
  '/api/lead',
  ...createPublicPostMiddleware({
    name: 'lead',
    jsonLimit: publicPostLimits.leadJsonLimit,
    windowMs: publicPostLimits.leadWindowMs,
    max: publicPostLimits.leadMax,
  }),
  async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const parsed = parseLeadBody(req.body);
      if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });
      const { error } = await supabase.from('marketing_leads').insert(parsed.payload);
      if (error) {
        console.error('marketing_leads.insert', error);
        return res.status(500).json({ ok: false, error: 'db_error' });
      }
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  },
);

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/health/deep', async (_req, res) => {
  try {
    if (!supabase) return res.status(500).json({ ok: false, db: false, error: 'supabase_not_configured' });
    const { error } = await supabase.from('participants').select('id', { count: 'exact', head: true });
    if (error) return res.status(500).json({ ok: false, db: false, error: 'db_unreachable' });
    return res.json({ ok: true, db: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, db: false, error: 'server_error' });
  }
});

registerWaiverSubmitRoute(app, {
  supabase,
  signaturesBucket: SIGNATURES_BUCKET,
  waiversBucket: WAIVERS_BUCKET,
  middleware: createPublicPostMiddleware({
    name: 'waiver_submit',
    jsonLimit: publicPostLimits.waiverJsonLimit,
    windowMs: publicPostLimits.waiverWindowMs,
    max: publicPostLimits.waiverMax,
  }),
});

registerAuthRoutes(app);

app.use(express.json({ limit: '10mb' }));

// Admin: fetch waiver metadata and return signed URLs
app.get('/api/admin/waivers/:id', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
    const waiverId = req.params.id;

    const { data: waiver, error: wErr } = await supabase
      .from('waivers')
      .select('participant_id, signature_image_url')
      .eq('id', waiverId)
      .maybeSingle();
    if (wErr || !waiver) return res.status(404).json({ ok: false, error: 'not_found' });

    const { data: audit, error: aErr } = await supabase
      .from('audit_trails')
      .select('document_pdf_url, document_sha256, locale, content_version, created_at, identity_snapshot')
      .eq('waiver_id', waiverId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (aErr || !audit) return res.status(404).json({ ok: false, error: 'audit_not_found' });

    // Create signed URLs (5 minutes)
    const signaturePath = splitStorageObjectPath(waiver.signature_image_url);
    const pdfPath = splitStorageObjectPath(audit.document_pdf_url);
    if (!signaturePath || !pdfPath) {
      return res.status(500).json({ ok: false, error: 'invalid_storage_path' });
    }
    const expiresIn = 60 * 5;

    const { data: sigSigned, error: sigErr } = await supabase.storage
      .from(signaturePath.bucket)
      .createSignedUrl(signaturePath.key, expiresIn);
    const { data: pdfSigned, error: pdfErr } = await supabase.storage
      .from(pdfPath.bucket)
      .createSignedUrl(pdfPath.key, expiresIn);
    if (sigErr || pdfErr) {
      console.error('signed url error', sigErr || pdfErr);
      return res.status(500).json({ ok: false, error: 'signed_url_failed' });
    }

    return res.json({
      ok: true,
      waiverId,
      participantId: waiver.participant_id,
      signatureUrl: sigSigned.signedUrl,
      documentPdfUrl: pdfSigned.signedUrl,
      documentSha256: audit.document_sha256,
      locale: audit.locale,
      content_version: audit.content_version,
      created_at: audit.created_at,
      identity_snapshot: audit.identity_snapshot,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

app.use(
  '/api/waivers',
  createWaiverPdfRouter({
    supabase,
    requireAuth: requireAdmin,
  }),
);

const adminCronRouter = express.Router();
adminCronRouter.use('/billing/generate-monthly-charges', requireAdminOrCron);
adminCronRouter.use('/notifications', requireAdminOrCron);
registerAdminBillingCronRoutes(adminCronRouter, { supabase });
registerAdminNotificationRoutes(adminCronRouter, { supabase });
app.use('/api/admin', adminCronRouter);

const adminBillingRouter = express.Router();
adminBillingRouter.use(requireAdmin);
registerStaffAuthRoutes(adminBillingRouter, { supabase });
registerAdminBillingRoutes(adminBillingRouter, { supabase });
registerAdminParticipantRoutes(adminBillingRouter, { supabase });
registerAdminReportingRoutes(adminBillingRouter, { supabase });
registerAdminSchedulingRoutes(adminBillingRouter, { supabase });
adminBillingRouter.use('/scheduling-v2', createAdminSchedulingV2Router({ supabase }));
registerAdminWaiverRoutes(adminBillingRouter, { supabase });
app.use('/api/admin', adminBillingRouter);

const viewerRouter = express.Router();
viewerRouter.use(createRequireViewerAccess());
registerViewerWaiverRoutes(viewerRouter, { supabase });
app.use('/api/viewer', viewerRouter);

app.use('/api/member', createMemberRouter());
app.use('/api/calendar', createCalendarRouter({ supabase }));

app.use(jsonPayloadTooLargeHandler);
app.use(jsonUnhandledErrorHandler);

export function startServer() {
  return app.listen(PORT, (error) => {
    if (error) {
      console.error(error);
      throw error;
    }
    console.log(`API listening on :${PORT}`);
  });
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  startServer();
}
