import { parsePagination, parseUuid } from '../../lib/adminRequestValidation.js';
import { sendDatabaseError } from '../../lib/exposeSupabaseError.js';
import {
  SESSION_CONTENT_DEFAULT_VISIBILITY,
  parseSessionContentNotes,
  parseSessionContentVideoUrl,
  parseSessionContentVisibility,
} from '../../lib/sessionContent.js';

export const SESSION_CONTENT_COLUMNS =
  'id, session_id, notes, video_url, visibility, created_at, updated_at';

function readContentFields(body, { creating }) {
  const source = body && typeof body === 'object' ? body : {};
  const notes = parseSessionContentNotes(source.notes);
  const videoUrl = parseSessionContentVideoUrl(source.video_url);
  const visibility = parseSessionContentVisibility(source.visibility);

  if (!notes.ok && !notes.omitted) return { error: 'invalid_notes' };
  if (!videoUrl.ok && !videoUrl.omitted) return { error: 'invalid_video_url' };
  if (!visibility.ok && !visibility.omitted) return { error: 'invalid_visibility' };

  const patch = {};
  if (!notes.omitted) patch.notes = notes.value;
  if (!videoUrl.omitted) patch.video_url = videoUrl.value;
  if (!visibility.omitted) patch.visibility = visibility.value;
  else if (creating) patch.visibility = SESSION_CONTENT_DEFAULT_VISIBILITY;

  return { patch };
}

async function findSession(supabase, sessionId) {
  const { data, error } = await supabase.from('sessions').select('id').eq('id', sessionId).maybeSingle();
  if (error) return { error };
  if (!data) return { missing: true };
  return { session: data };
}

async function findContent(supabase, sessionId) {
  const { data, error } = await supabase
    .from('session_content')
    .select(SESSION_CONTENT_COLUMNS)
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error) return { error };
  if (!data) return { missing: true };
  return { content: data };
}

/**
 * Admin scheduling-v2 session content CRUD.
 * Parent router is mounted under `/api/admin` and already runs admin auth + RBAC.
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient | null }} ctx
 */
export function registerAdminSchedulingV2SessionContentRoutes(router, { supabase } = {}) {
  router.get('/session-content', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });

      const page = parsePagination(req.query);
      if (!page.ok) return res.status(400).json({ ok: false, error: page.error });
      const { limit, offset } = page;

      let sessionId = null;
      if (req.query.session_id !== undefined && req.query.session_id !== '') {
        sessionId = parseUuid(req.query.session_id);
        if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid_session_id' });
      }

      let visibility = null;
      if (req.query.visibility !== undefined && req.query.visibility !== '') {
        const parsed = parseSessionContentVisibility(req.query.visibility);
        if (!parsed.ok || parsed.omitted) {
          return res.status(400).json({ ok: false, error: 'invalid_visibility' });
        }
        visibility = parsed.value;
      }

      let q = supabase
        .from('session_content')
        .select(SESSION_CONTENT_COLUMNS)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + limit - 1);
      if (sessionId) q = q.eq('session_id', sessionId);
      if (visibility) q = q.eq('visibility', visibility);

      const { data, error } = await q;
      if (error) return sendDatabaseError(res, error, { context: 'scheduling.session_content.list' });

      return res.json({
        ok: true,
        limit,
        offset,
        rowCount: (data ?? []).length,
        rows: data ?? [],
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.get('/sessions/:sessionId/content', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const sessionId = parseUuid(req.params.sessionId);
      if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid_session_id' });

      const session = await findSession(supabase, sessionId);
      if (session.error) return sendDatabaseError(res, session.error, { context: 'session_content.session_lookup' });
      if (session.missing) return res.status(404).json({ ok: false, error: 'session_not_found' });

      const content = await findContent(supabase, sessionId);
      if (content.error) return sendDatabaseError(res, content.error, { context: 'session_content.get' });
      if (content.missing) return res.status(404).json({ ok: false, error: 'content_not_found' });

      return res.json({ ok: true, content: content.content });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/sessions/:sessionId/content', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const sessionId = parseUuid(req.params.sessionId);
      if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid_session_id' });

      const parsed = readContentFields(req.body, { creating: true });
      if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

      const session = await findSession(supabase, sessionId);
      if (session.error) return sendDatabaseError(res, session.error, { context: 'session_content.session_lookup' });
      if (session.missing) return res.status(404).json({ ok: false, error: 'session_not_found' });

      const existing = await findContent(supabase, sessionId);
      if (existing.error) return sendDatabaseError(res, existing.error, { context: 'session_content.lookup' });
      if (!existing.missing) return res.status(409).json({ ok: false, error: 'already_exists' });

      const { data, error } = await supabase
        .from('session_content')
        .insert({ session_id: sessionId, ...parsed.patch })
        .select(SESSION_CONTENT_COLUMNS)
        .single();
      if (error) return sendDatabaseError(res, error, { context: 'session_content.insert' });

      return res.json({ ok: true, content: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.patch('/sessions/:sessionId/content', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const sessionId = parseUuid(req.params.sessionId);
      if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid_session_id' });

      const session = await findSession(supabase, sessionId);
      if (session.error) return sendDatabaseError(res, session.error, { context: 'session_content.session_lookup' });
      if (session.missing) return res.status(404).json({ ok: false, error: 'session_not_found' });

      const existing = await findContent(supabase, sessionId);
      if (existing.error) return sendDatabaseError(res, existing.error, { context: 'session_content.lookup' });
      if (existing.missing) return res.status(404).json({ ok: false, error: 'content_not_found' });

      const parsed = readContentFields(req.body, { creating: false });
      if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });
      if (!Object.keys(parsed.patch).length) {
        return res.status(400).json({ ok: false, error: 'no_updates' });
      }

      const { data, error } = await supabase
        .from('session_content')
        .update(parsed.patch)
        .eq('session_id', sessionId)
        .select(SESSION_CONTENT_COLUMNS)
        .single();
      if (error) return sendDatabaseError(res, error, { context: 'session_content.update' });

      return res.json({ ok: true, content: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.delete('/sessions/:sessionId/content', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const sessionId = parseUuid(req.params.sessionId);
      if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid_session_id' });

      const session = await findSession(supabase, sessionId);
      if (session.error) return sendDatabaseError(res, session.error, { context: 'session_content.session_lookup' });
      if (session.missing) return res.status(404).json({ ok: false, error: 'session_not_found' });

      const existing = await findContent(supabase, sessionId);
      if (existing.error) return sendDatabaseError(res, existing.error, { context: 'session_content.lookup' });
      if (existing.missing) return res.status(404).json({ ok: false, error: 'content_not_found' });

      const { data, error } = await supabase
        .from('session_content')
        .delete()
        .eq('session_id', sessionId)
        .select(SESSION_CONTENT_COLUMNS)
        .maybeSingle();
      if (error) return sendDatabaseError(res, error, { context: 'session_content.delete' });
      if (!data) return res.status(404).json({ ok: false, error: 'content_not_found' });

      return res.json({ ok: true, content: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
