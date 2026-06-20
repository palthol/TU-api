/**
 * Admin scheduling routes: sessions + attendance (service-role Supabase).
 */

import {
  ATTENDANCE_STATUSES,
  parseAttendanceRecordsBody,
  parseIsoDate,
  parseIsoDateTime,
  parseUuid,
} from '../../lib/adminRequestValidation.js';

/**
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient | null }} ctx
 */
export function registerAdminSchedulingRoutes(router, { supabase }) {
  router.get('/scheduling/sessions', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });

      const limit = Math.min(Number.parseInt(String(req.query.limit || ''), 10) || 50, 200);
      const offset = Math.max(Number.parseInt(String(req.query.offset || ''), 10) || 0, 0);
      const startDate = typeof req.query.start === 'string' ? parseIsoDate(req.query.start) : null;
      const endDate = typeof req.query.end === 'string' ? parseIsoDate(req.query.end) : null;
      const includeCancelled = req.query.include_cancelled === 'true';
      const sessionLabel =
        typeof req.query.session_label === 'string' && req.query.session_label.trim()
          ? req.query.session_label.trim()
          : null;

      if (req.query.start && !startDate) {
        return res.status(400).json({ ok: false, error: 'invalid_start' });
      }
      if (req.query.end && !endDate) {
        return res.status(400).json({ ok: false, error: 'invalid_end' });
      }

      let q = supabase
        .from('sessions')
        .select(
          'id, starts_at, ends_at, session_label, schedule_template_id, notes, cancelled_at, created_at, updated_at',
        )
        .order('starts_at', { ascending: true })
        .range(offset, offset + limit - 1);

      if (startDate) {
        q = q.gte('starts_at', `${startDate}T00:00:00.000Z`);
      }
      if (endDate) {
        q = q.lte('starts_at', `${endDate}T23:59:59.999Z`);
      }
      if (!includeCancelled) {
        q = q.is('cancelled_at', null);
      }
      if (sessionLabel) {
        q = q.eq('session_label', sessionLabel);
      }

      const { data, error } = await q;
      if (error) return res.status(400).json({ ok: false, error: error.message });

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

  router.get('/scheduling/sessions/:sessionId', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const sessionId = parseUuid(req.params.sessionId);
      if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid_session_id' });

      const { data: session, error: sessionErr } = await supabase
        .from('sessions')
        .select(
          'id, starts_at, ends_at, session_label, schedule_template_id, notes, cancelled_at, created_at, updated_at',
        )
        .eq('id', sessionId)
        .maybeSingle();
      if (sessionErr) return res.status(400).json({ ok: false, error: sessionErr.message });
      if (!session) return res.status(404).json({ ok: false, error: 'session_not_found' });

      const { data: attendance, error: attErr } = await supabase
        .from('attendance_records')
        .select('id, participant_id, status, recorded_at, recorded_by, created_at, updated_at')
        .eq('session_id', sessionId)
        .order('recorded_at', { ascending: true });
      if (attErr) return res.status(400).json({ ok: false, error: attErr.message });

      return res.json({
        ok: true,
        session,
        attendance: attendance ?? [],
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/scheduling/sessions', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });

      const { starts_at, ends_at, session_label, schedule_template_id, notes } = req.body || {};
      const startsAt = parseIsoDateTime(starts_at);
      const endsAt = parseIsoDateTime(ends_at);
      if (!startsAt) return res.status(400).json({ ok: false, error: 'invalid_starts_at' });
      if (!endsAt) return res.status(400).json({ ok: false, error: 'invalid_ends_at' });
      if (new Date(endsAt) <= new Date(startsAt)) {
        return res.status(400).json({ ok: false, error: 'ends_at_must_be_after_starts_at' });
      }

      const templateId =
        schedule_template_id != null && schedule_template_id !== ''
          ? parseUuid(schedule_template_id)
          : null;
      if (schedule_template_id != null && schedule_template_id !== '' && !templateId) {
        return res.status(400).json({ ok: false, error: 'invalid_schedule_template_id' });
      }

      const label =
        typeof session_label === 'string' && session_label.trim() ? session_label.trim() : null;
      const sessionNotes = typeof notes === 'string' && notes.trim() ? notes.trim() : null;

      const { data, error } = await supabase
        .from('sessions')
        .insert({
          starts_at: startsAt,
          ends_at: endsAt,
          session_label: label,
          schedule_template_id: templateId,
          notes: sessionNotes,
        })
        .select(
          'id, starts_at, ends_at, session_label, schedule_template_id, notes, cancelled_at, created_at, updated_at',
        )
        .single();

      if (error) {
        console.error('sessions.insert', error);
        return res.status(400).json({ ok: false, error: error.message });
      }

      return res.json({ ok: true, session: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.patch('/scheduling/sessions/:sessionId', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const sessionId = parseUuid(req.params.sessionId);
      if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid_session_id' });

      const { data: existing, error: findErr } = await supabase
        .from('sessions')
        .select('id, starts_at, ends_at, cancelled_at')
        .eq('id', sessionId)
        .maybeSingle();
      if (findErr) return res.status(400).json({ ok: false, error: findErr.message });
      if (!existing) return res.status(404).json({ ok: false, error: 'session_not_found' });

      const body = req.body || {};
      const patch = {};

      if (body.starts_at !== undefined) {
        const startsAt = parseIsoDateTime(body.starts_at);
        if (!startsAt) return res.status(400).json({ ok: false, error: 'invalid_starts_at' });
        patch.starts_at = startsAt;
      }
      if (body.ends_at !== undefined) {
        const endsAt = parseIsoDateTime(body.ends_at);
        if (!endsAt) return res.status(400).json({ ok: false, error: 'invalid_ends_at' });
        patch.ends_at = endsAt;
      }
      if (body.session_label !== undefined) {
        patch.session_label =
          typeof body.session_label === 'string' && body.session_label.trim()
            ? body.session_label.trim()
            : null;
      }
      if (body.schedule_template_id !== undefined) {
        if (body.schedule_template_id === null || body.schedule_template_id === '') {
          patch.schedule_template_id = null;
        } else {
          const templateId = parseUuid(body.schedule_template_id);
          if (!templateId) return res.status(400).json({ ok: false, error: 'invalid_schedule_template_id' });
          patch.schedule_template_id = templateId;
        }
      }
      if (body.notes !== undefined) {
        patch.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
      }
      if (body.cancel === true) {
        patch.cancelled_at = new Date().toISOString();
      } else if (body.cancel === false) {
        patch.cancelled_at = null;
      }

      const nextStarts = patch.starts_at ?? existing.starts_at;
      const nextEnds = patch.ends_at ?? existing.ends_at;
      if (new Date(nextEnds) <= new Date(nextStarts)) {
        return res.status(400).json({ ok: false, error: 'ends_at_must_be_after_starts_at' });
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ ok: false, error: 'no_updates' });
      }

      const { data, error } = await supabase
        .from('sessions')
        .update(patch)
        .eq('id', sessionId)
        .select(
          'id, starts_at, ends_at, session_label, schedule_template_id, notes, cancelled_at, created_at, updated_at',
        )
        .single();

      if (error) {
        console.error('sessions.update', error);
        return res.status(400).json({ ok: false, error: error.message });
      }

      return res.json({ ok: true, session: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/scheduling/sessions/:sessionId/attendance', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const sessionId = parseUuid(req.params.sessionId);
      if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid_session_id' });

      const parsed = parseAttendanceRecordsBody(req.body);
      if ('error' in parsed) {
        return res.status(400).json({ ok: false, error: parsed.error });
      }

      const enforceEntitlement = req.body?.enforce_entitlement !== false;
      const defaultRecordedBy =
        typeof req.body?.recorded_by === 'string' && req.body.recorded_by.trim()
          ? req.body.recorded_by.trim()
          : 'admin_api';

      const { data: session, error: sessionErr } = await supabase
        .from('sessions')
        .select('id, session_label, cancelled_at')
        .eq('id', sessionId)
        .maybeSingle();
      if (sessionErr) return res.status(400).json({ ok: false, error: sessionErr.message });
      if (!session) return res.status(404).json({ ok: false, error: 'session_not_found' });
      if (session.cancelled_at) {
        return res.status(400).json({ ok: false, error: 'session_cancelled' });
      }

      const blocked = [];
      const rows = [];

      for (const rec of parsed.records) {
        if (enforceEntitlement && rec.status === 'present') {
          const { data: canAttend, error: entErr } = await supabase.rpc('can_attend_group_session', {
            p_participant_id: rec.participant_id,
            p_session_label: session.session_label ?? null,
          });
          if (entErr) {
            console.error('can_attend_group_session', entErr);
            return res.status(400).json({ ok: false, error: entErr.message });
          }
          if (!canAttend) {
            blocked.push({ participant_id: rec.participant_id, reason: 'no_group_entitlement' });
            continue;
          }
        }

        rows.push({
          session_id: sessionId,
          participant_id: rec.participant_id,
          status: rec.status,
          recorded_by: rec.recorded_by ?? defaultRecordedBy,
          recorded_at: new Date().toISOString(),
        });
      }

      if (rows.length === 0 && blocked.length > 0) {
        return res.status(400).json({ ok: false, error: 'all_records_blocked', blocked });
      }

      const { data, error } = await supabase
        .from('attendance_records')
        .upsert(rows, { onConflict: 'session_id,participant_id' })
        .select('id, participant_id, status, recorded_at, recorded_by');

      if (error) {
        console.error('attendance_records.upsert', error);
        return res.status(400).json({ ok: false, error: error.message });
      }

      return res.json({
        ok: true,
        session_id: sessionId,
        upserted: data ?? [],
        blocked,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}

export { ATTENDANCE_STATUSES };
