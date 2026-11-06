import { parsePagination, parseUuid } from '../../lib/adminRequestValidation.js';
import { sendDatabaseError } from '../../lib/exposeSupabaseError.js';

export const CLASS_COLUMNS =
  'id, name, instructor, day_of_week, recurrence, start_time, duration_minutes, capacity, is_active, created_at, updated_at';

const START_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const NAME_MAX = 200;
const INSTRUCTOR_MAX = 200;
const MAX_DURATION_MINUTES = 1440;
const MAX_CAPACITY = 500;
const RECURRENCE_WEEKLY = 'weekly';

function parseRequiredName(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > NAME_MAX) return null;
  return trimmed;
}

function parseRequiredInstructor(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > INSTRUCTOR_MAX) return null;
  return trimmed;
}

function parseDayOfWeek(value) {
  let n = null;
  if (typeof value === 'number' && Number.isInteger(value)) n = value;
  else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    n = Number.parseInt(value.trim(), 10);
  }
  if (n == null || n < 1 || n > 7) return null;
  return n;
}

function parseDurationMinutes(value) {
  let n = null;
  if (typeof value === 'number' && Number.isInteger(value)) n = value;
  else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    n = Number.parseInt(value.trim(), 10);
  }
  if (n == null || n < 1 || n > MAX_DURATION_MINUTES) return null;
  return n;
}

function parseCapacity(value) {
  let n = null;
  if (typeof value === 'number' && Number.isInteger(value)) n = value;
  else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    n = Number.parseInt(value.trim(), 10);
  }
  if (n == null || n < 1 || n > MAX_CAPACITY) return null;
  return n;
}

function parseStartTime(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(START_TIME_RE);
  if (!match) return null;
  return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
}

function parseRecurrence(value) {
  if (value === undefined || value === null || value === '') return RECURRENCE_WEEKLY;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed === RECURRENCE_WEEKLY ? RECURRENCE_WEEKLY : null;
}

function parseIsActive(value, { defaultValue } = {}) {
  if (value === undefined) return { ok: true, value: defaultValue, omitted: true };
  if (typeof value !== 'boolean') return { ok: false };
  return { ok: true, value, omitted: false };
}

/**
 * Admin scheduling-v2 class CRUD.
 * Parent router is mounted under `/api/admin` and already runs admin auth + RBAC.
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient | null }} ctx
 */
export function registerAdminSchedulingV2ClassRoutes(router, { supabase } = {}) {
  router.get('/classes', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });

      const page = parsePagination(req.query);
      if (!page.ok) return res.status(400).json({ ok: false, error: page.error });
      const { limit, offset } = page;
      const includeInactive = req.query.include_inactive === 'true';

      let q = supabase
        .from('classes')
        .select(CLASS_COLUMNS)
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true })
        .order('name', { ascending: true })
        .range(offset, offset + limit - 1);

      if (!includeInactive) {
        q = q.eq('is_active', true);
      }

      const { data, error } = await q;
      if (error) return sendDatabaseError(res, error, { context: 'scheduling.classes.list' });

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

  router.get('/classes/:classId', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const classId = parseUuid(req.params.classId);
      if (!classId) return res.status(400).json({ ok: false, error: 'invalid_class_id' });

      const { data, error } = await supabase
        .from('classes')
        .select(CLASS_COLUMNS)
        .eq('id', classId)
        .maybeSingle();
      if (error) return sendDatabaseError(res, error, { context: 'scheduling.classes.get' });
      if (!data) return res.status(404).json({ ok: false, error: 'class_not_found' });

      return res.json({ ok: true, class: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/classes', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });

      const body = req.body || {};
      const name = parseRequiredName(body.name);
      const instructor = parseRequiredInstructor(body.instructor);
      const dayOfWeek = parseDayOfWeek(body.day_of_week);
      const startTime = parseStartTime(body.start_time);
      const durationMinutes = parseDurationMinutes(body.duration_minutes);
      const capacity = parseCapacity(body.capacity);
      const recurrence = parseRecurrence(body.recurrence);
      const isActive = parseIsActive(body.is_active, { defaultValue: true });

      if (!name) return res.status(400).json({ ok: false, error: 'invalid_name' });
      if (!instructor) return res.status(400).json({ ok: false, error: 'invalid_instructor' });
      if (dayOfWeek == null) return res.status(400).json({ ok: false, error: 'invalid_day_of_week' });
      if (!startTime) return res.status(400).json({ ok: false, error: 'invalid_start_time' });
      if (durationMinutes == null) {
        return res.status(400).json({ ok: false, error: 'invalid_duration_minutes' });
      }
      if (capacity == null) return res.status(400).json({ ok: false, error: 'invalid_capacity' });
      if (!recurrence) return res.status(400).json({ ok: false, error: 'invalid_recurrence' });
      if (!isActive.ok) return res.status(400).json({ ok: false, error: 'invalid_is_active' });

      const { data, error } = await supabase
        .from('classes')
        .insert({
          name,
          instructor,
          day_of_week: dayOfWeek,
          recurrence,
          start_time: startTime,
          duration_minutes: durationMinutes,
          capacity,
          is_active: isActive.value,
        })
        .select(CLASS_COLUMNS)
        .single();

      if (error) return sendDatabaseError(res, error, { context: 'classes.insert' });
      return res.json({ ok: true, class: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.patch('/classes/:classId', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const classId = parseUuid(req.params.classId);
      if (!classId) return res.status(400).json({ ok: false, error: 'invalid_class_id' });

      const { data: existing, error: findErr } = await supabase
        .from('classes')
        .select('id')
        .eq('id', classId)
        .maybeSingle();
      if (findErr) return sendDatabaseError(res, findErr, { context: 'classes.lookup' });
      if (!existing) return res.status(404).json({ ok: false, error: 'class_not_found' });

      const body = req.body || {};
      const patch = {};

      if (body.name !== undefined) {
        const name = parseRequiredName(body.name);
        if (!name) return res.status(400).json({ ok: false, error: 'invalid_name' });
        patch.name = name;
      }
      if (body.instructor !== undefined) {
        const instructor = parseRequiredInstructor(body.instructor);
        if (!instructor) return res.status(400).json({ ok: false, error: 'invalid_instructor' });
        patch.instructor = instructor;
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
      if (body.capacity !== undefined) {
        const capacity = parseCapacity(body.capacity);
        if (capacity == null) return res.status(400).json({ ok: false, error: 'invalid_capacity' });
        patch.capacity = capacity;
      }
      if (body.recurrence !== undefined) {
        const recurrence = parseRecurrence(body.recurrence);
        if (!recurrence) return res.status(400).json({ ok: false, error: 'invalid_recurrence' });
        patch.recurrence = recurrence;
      }
      if (body.is_active !== undefined) {
        const isActive = parseIsActive(body.is_active);
        if (!isActive.ok) return res.status(400).json({ ok: false, error: 'invalid_is_active' });
        patch.is_active = isActive.value;
      }

      if (!Object.keys(patch).length) {
        return res.status(400).json({ ok: false, error: 'no_updates' });
      }

      const { data, error } = await supabase
        .from('classes')
        .update(patch)
        .eq('id', classId)
        .select(CLASS_COLUMNS)
        .single();
      if (error) return sendDatabaseError(res, error, { context: 'classes.update' });

      return res.json({ ok: true, class: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.delete('/classes/:classId', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const classId = parseUuid(req.params.classId);
      if (!classId) return res.status(400).json({ ok: false, error: 'invalid_class_id' });

      const { data, error } = await supabase
        .from('classes')
        .delete()
        .eq('id', classId)
        .select(CLASS_COLUMNS)
        .maybeSingle();
      if (error) return sendDatabaseError(res, error, { context: 'classes.delete' });
      if (!data) return res.status(404).json({ ok: false, error: 'class_not_found' });

      return res.json({ ok: true, class: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
