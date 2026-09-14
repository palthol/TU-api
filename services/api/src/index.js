import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { createWaiverPdfRouter } from './routes/waivers/pdf.js';
import { registerWaiverSubmitRoute } from './services/accounts/submitWaiver.js';
import { registerAdminBillingRoutes } from './routes/admin/billing.js';
import { registerAdminParticipantRoutes } from './routes/admin/participants.js';
import { registerAdminReportingRoutes } from './routes/admin/reporting.js';
import { registerAdminNotificationRoutes } from './routes/admin/notifications.js';
import { registerAdminWaiverRoutes } from './routes/admin/waivers.js';
import { createRequireViewerAccess } from './lib/cloudflareAccess.js';
import { registerViewerWaiverRoutes } from './routes/viewer/waivers.js';
import { warnIfSupabaseKeyIsNotServiceRole } from './lib/warnIfSupabaseKeyIsNotServiceRole.js';
import { createRequireAdminOrCron } from './lib/requireAdminOrCron.js';
import { registerAdminSchedulingRoutes } from './routes/admin/scheduling.js';

const app = express();
// CORS: allow configured origin or all in dev
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
if (allowedOrigin === '*') {
  app.use(cors());
} else {
  app.use(cors({ origin: allowedOrigin }));
}
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3001;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseServiceRole ? createClient(supabaseUrl, supabaseServiceRole) : null;
if (supabaseServiceRole) warnIfSupabaseKeyIsNotServiceRole(supabaseServiceRole);
const SIGNATURES_BUCKET = process.env.SIGNATURES_BUCKET || 'signatures';
const WAIVERS_BUCKET = process.env.WAIVERS_BUCKET || 'signed-waivers';

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

app.post('/api/lead', async (req, res) => {
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
});

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
});

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

const adminBillingRouter = express.Router();
adminBillingRouter.use(requireAdmin);
registerAdminBillingRoutes(adminBillingRouter, { supabase });
registerAdminParticipantRoutes(adminBillingRouter, { supabase });
registerAdminReportingRoutes(adminBillingRouter, { supabase });
registerAdminSchedulingRoutes(adminBillingRouter, { supabase });
registerAdminWaiverRoutes(adminBillingRouter, { supabase });
app.use('/api/admin', adminBillingRouter);

const adminCronRouter = express.Router();
adminCronRouter.use(createRequireAdminOrCron(requireAdmin));
registerAdminNotificationRoutes(adminCronRouter, { supabase });
app.use('/api/admin', adminCronRouter);

const viewerRouter = express.Router();
viewerRouter.use(createRequireViewerAccess());
registerViewerWaiverRoutes(viewerRouter, { supabase });
app.use('/api/viewer', viewerRouter);

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
