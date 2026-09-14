/**
 * Admin scheduling routes: templates, session generation, sessions, attendance
 * (service-role Supabase).
 */

import {
  ATTENDANCE_STATUSES,
  parseAttendanceRecordsBody,
  parseIsoDate,
  parseIsoDateTime,
  parseUuid,
} from '../../lib/adminRequestValidation.js';

const TEMPLATE_COLUMNS =
  'id, name, day_of_week, start_time, duration_minutes, is_active, notes, created_at, updated_at';
const MAX_GENERATE_SPAN_DAYS = 366;
const START_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** @param {unknown} value */
function parseDayOfWeek(value) {
  let n = null;
  if (typeof value === 'number' && Number.isInteger(value)) n = value;
  else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    n = Number.parseInt(value.trim(), 10);
  }
  if (n == null || n < 1 || n > 7) return null;
  return n;
}

/** @param {unknown} value */
function parseDurationMinutes(value) {
  let n = null;
  if (typeof value === 'number' && Number.isInteger(value)) n = value;
  else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    n = Number.parseInt(value.trim(), 10);
  }
  if (n == null || n <= 0) return null;
  return n;
}

/** @param {unknown} value */
function parseStartTime(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(START_TIME_RE);
  if (!match) return null;
  return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
}

/** @param {unknown} value */
function parseTemplateName(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim();
}

/** @param {unknown} value */
function parseOptionalNotes(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Inclusive YYYY-MM-DD span in whole UTC days. */
function utcDateSpanDays(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.round((end - start) / 86400000);
}

/**
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient | null }} ctx
 */
export function registerAdminSchedulingRoutes(router, { supabase }) {
  router.get('/scheduling/templates', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });

      const limit = Math.min(Number.parseInt(String(req.query.limit || ''), 10) || 50, 200);
      const offset = Math.max(Number.parseInt(String(req.query.offset || ''), 10) || 0, 0);
      const includeInactive = req.query.include_inactive === 'true';

      let q = supabase
        .from('schedule_templates')
        .select(TEMPLATE_COLUMNS)
        .order('day_of_week', { ascending: true })
        .range(offset, offset + limit - 1);

      if (!includeInactive) {
        q = q.eq('is_active', true);
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

  router.get('/scheduling/templates/:templateId', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const templateId = parseUuid(req.params.templateId);
      if (!templateId) return res.status(400).json({ ok: false, error: 'invalid_template_id' });

      const { data, error } = await supabase
        .from('schedule_templates')
        .select(TEMPLATE_COLUMNS)
        .eq('id', templateId)
        .maybeSingle();
      if (error) return res.status(400).json({ ok: false, error: error.message });
      if (!data) return res.status(404).json({ ok: false, error: 'template_not_found' });

      return res.json({ ok: true, template: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/scheduling/templates', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });

      const body = req.body || {};
      const name = parseTemplateName(body.name);
      const dayOfWeek = parseDayOfWeek(body.day_of_week);
      const startTime = parseStartTime(body.start_time);
      const durationMinutes = parseDurationMinutes(body.duration_minutes);
      const notes = parseOptionalNotes(body.notes);
      const isActive = body.is_active === undefined ? true : body.is_active;

      if (!name) return res.status(400).json({ ok: false, error: 'name_required' });
      if (dayOfWeek == null) return res.status(400).json({ ok: false, error: 'invalid_day_of_week' });
      if (!startTime) return res.status(400).json({ ok: false, error: 'invalid_start_time' });
      if (durationMinutes == null) {
        return res.status(400).json({ ok: false, error: 'invalid_duration_minutes' });
      }
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ ok: false, error: 'invalid_is_active' });
      }
      if (body.notes !== undefined && typeof body.notes !== 'string' && body.notes !== null) {
        return res.status(400).json({ ok: false, error: 'invalid_notes' });
      }

      const { data, error } = await supabase
        .from('schedule_templates')
        .insert({
          name,
          day_of_week: dayOfWeek,
          start_time: startTime,
          duration_minutes: durationMinutes,
          is_active: isActive,
          notes: notes === undefined ? null : notes,
        })
        .select(TEMPLATE_COLUMNS)
        .single();

      if (error) {
        console.error('schedule_templates.insert', error);
        return res.status(400).json({ ok: false, error: error.message });
      }

      return res.json({ ok: true, template: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.patch('/scheduling/templates/:templateId', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const templateId = parseUuid(req.params.templateId);
      if (!templateId) return res.status(400).json({ ok: false, error: 'invalid_template_id' });

      const { data: existing, error: findErr } = await supabase
        .from('schedule_templates')
        .select('id')
        .eq('id', templateId)
        .maybeSingle();
      if (findErr) return res.status(400).json({ ok: false, error: findErr.message });
      if (!existing) return res.status(404).json({ ok: false, error: 'template_not_found' });

      const body = req.body || {};
      const patch = {};

      if (body.name !== undefined) {
        const name = parseTemplateName(body.name);
        if (!name) return res.status(400).json({ ok: false, error: 'name_required' });
        patch.name = name;
      }
      if (body.day_of_week !== undefined) {
        const dayOfWeek = parseDayOfWeek(body.day_of_week);
        if (dayOfWeek == null) return res.status(400).json({ ok: false, error: 'invalid_day_of_week' });
        patch.day_of_week = dayOfWeek;
      }
      if (body.start_time !== undefined) {
        const startTime = parseStartTime(body.start_time);
        if (!startTime) return res.status(400).json({ ok: false, error: 'invalid_start_time' });
        patch.start_time = startTime;
      }
      if (body.duration_minutes !== undefined) {
        const durationMinutes = parseDurationMinutes(body.duration_minutes);
        if (durationMinutes == null) {
          return res.status(400).json({ ok: false, error: 'invalid_duration_minutes' });
        }
        patch.duration_minutes = durationMinutes;
      }
      if (body.is_active !== undefined) {
        if (typeof body.is_active !== 'boolean') {
          return res.status(400).json({ ok: false, error: 'invalid_is_active' });
        }
        patch.is_active = body.is_active;
      }
      if (body.notes !== undefined) {
        if (body.notes !== null && typeof body.notes !== 'string') {
          return res.status(400).json({ ok: false, error: 'invalid_notes' });
        }
        patch.notes = parseOptionalNotes(body.notes);
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ ok: false, error: 'no_updates' });
      }

      const { data, error } = await supabase
        .from('schedule_templates')
        .update(patch)
        .eq('id', templateId)
        .select(TEMPLATE_COLUMNS)
        .single();

      if (error) {
        console.error('schedule_templates.update', error);
        return res.status(400).json({ ok: false, error: error.message });
      }

      return res.json({ ok: true, template: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/scheduling/generate-sessions', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });

      const body = req.body || {};
      const startDate = parseIsoDate(body.start);
      const endDate = parseIsoDate(body.end);
      if (!startDate) return res.status(400).json({ ok: false, error: 'invalid_start' });
      if (!endDate) return res.status(400).json({ ok: false, error: 'invalid_end' });
      if (endDate < startDate) {
        return res.status(400).json({ ok: false, error: 'end_must_be_on_or_after_start' });
      }
      if (utcDateSpanDays(startDate, endDate) > MAX_GENERATE_SPAN_DAYS) {
        return res.status(400).json({ ok: false, error: 'range_too_long' });
      }

      let templateId = null;
      if (body.template_id != null && body.template_id !== '') {
        templateId = parseUuid(body.template_id);
        if (!templateId) return res.status(400).json({ ok: false, error: 'invalid_template_id' });
      }

      const { data, error } = await supabase.rpc('generate_sessions', {
        p_start_date: startDate,
        p_end_date: endDate,
        p_template_id: templateId,
      });

      if (error) {
        const key = error.message || 'generate_sessions_failed';
        const status = key === 'template_not_found' ? 404 : 400;
        return res.status(status).json({ ok: false, error: key });
      }

      const created = Array.isArray(data?.created) ? data.created : [];
      return res.json({
        ok: true,
        start: startDate,
        end: endDate,
        created_count: Number.isInteger(data?.created_count) ? data.created_count : created.length,
        skipped_count: Number.isInteger(data?.skipped_count) ? data.skipped_count : 0,
        created,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

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
