import { parsePagination, parseUuid } from '../../lib/adminRequestValidation.js';
import { sendDatabaseError } from '../../lib/exposeSupabaseError.js';

export const BOOKING_COLUMNS =
  'id, session_id, participant_id, status, created_at, updated_at, cancelled_at, checked_in_at, no_show_at, promoted_at, created_by, cancelled_by, checked_in_by, no_show_by';

const STATUS_RANK = {
  booked: 0,
  waitlisted: 1,
  attended: 2,
  no_show: 3,
  cancelled: 4,
  late_cancelled: 5,
};

const OCCUPYING_STATUSES = new Set(['booked', 'attended', 'no_show']);

function actorLabel(req) {
  const label = req.staff?.actorLabel;
  if (typeof label !== 'string') return null;
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return trimmed;
}

function publicBooking(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.id,
    session_id: row.session_id,
    participant_id: row.participant_id,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    cancelled_at: row.cancelled_at ?? null,
    checked_in_at: row.checked_in_at ?? null,
    no_show_at: row.no_show_at ?? null,
    promoted_at: row.promoted_at ?? null,
    created_by: row.created_by ?? null,
    cancelled_by: row.cancelled_by ?? null,
    checked_in_by: row.checked_in_by ?? null,
    no_show_by: row.no_show_by ?? null,
  };
}

function sortRoster(rows) {
  return [...rows].sort((a, b) => {
    const rankA = STATUS_RANK[a.status] ?? 50;
    const rankB = STATUS_RANK[b.status] ?? 50;
    if (rankA !== rankB) return rankA - rankB;
    const created = String(a.created_at || '').localeCompare(String(b.created_at || ''));
    if (created !== 0) return created;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function effectiveCapacity(session, classRow) {
  if (session?.capacity != null) return session.capacity;
  if (classRow?.capacity != null) return classRow.capacity;
  return null;
}

/**
 * Admin scheduling-v2 staff booking routes.
 * Parent router is mounted under `/api/admin` and already runs admin auth + RBAC.
 * Member self-booking stays on the stub `/api/member/bookings` routes.
 * @param {import('express').Router} router
 * @param {{ supabase?: import('@supabase/supabase-js').SupabaseClient | null }} ctx
 */
export function registerAdminSchedulingV2BookingRoutes(router, { supabase } = {}) {
  router.get('/sessions/:sessionId/bookings', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const sessionId = parseUuid(req.params.sessionId);
      if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid_session_id' });

      const page = parsePagination(req.query);
      if (!page.ok) return res.status(400).json({ ok: false, error: page.error });
      const { limit, offset } = page;

      const { data: session, error: sessionErr } = await supabase
        .from('sessions')
        .select('id, capacity, class_id, cancelled_at, starts_at, ends_at, session_label')
        .eq('id', sessionId)
        .maybeSingle();
      if (sessionErr) return sendDatabaseError(res, sessionErr, { context: 'bookings.session_lookup' });
      if (!session) return res.status(404).json({ ok: false, error: 'session_not_found' });

      let classRow = null;
      if (session.class_id) {
        const { data, error } = await supabase
          .from('classes')
          .select('id, capacity')
          .eq('id', session.class_id)
          .maybeSingle();
        if (error) return sendDatabaseError(res, error, { context: 'bookings.class_lookup' });
        classRow = data;
      }

      const { data: bookingRows, error: bookingErr } = await supabase
        .from('bookings')
        .select(BOOKING_COLUMNS)
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
      if (bookingErr) return sendDatabaseError(res, bookingErr, { context: 'bookings.list' });

      const allRows = sortRoster(bookingRows ?? []);
      const participantIds = [...new Set(allRows.map((row) => row.participant_id).filter(Boolean))];
      const peopleById = new Map();
      if (participantIds.length) {
        const { data: people, error: peopleErr } = await supabase
          .from('participants')
          .select('id, full_name, email')
          .in('id', participantIds);
        if (peopleErr) return sendDatabaseError(res, peopleErr, { context: 'bookings.participants' });
        for (const person of people ?? []) {
          peopleById.set(person.id, { id: person.id, full_name: person.full_name, email: person.email });
        }
      }

      const pageRows = allRows.slice(offset, offset + limit).map((row) => ({
        ...publicBooking(row),
        participant: peopleById.get(row.participant_id) ?? null,
      }));

      const bookedCount = allRows.filter((row) => row.status === 'booked').length;
      const waitlistCount = allRows.filter((row) => row.status === 'waitlisted').length;
      const occupiedCount = allRows.filter((row) => OCCUPYING_STATUSES.has(row.status)).length;

      return res.json({
        ok: true,
        session_id: sessionId,
        capacity: effectiveCapacity(session, classRow),
        occupied_count: occupiedCount,
        booked_count: bookedCount,
        waitlist_count: waitlistCount,
        limit,
        offset,
        rowCount: pageRows.length,
        rows: pageRows,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/sessions/:sessionId/bookings', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const sessionId = parseUuid(req.params.sessionId);
      if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid_session_id' });
      const participantId = parseUuid(req.body?.participant_id);
      if (!participantId) return res.status(400).json({ ok: false, error: 'invalid_participant_id' });

      const { data, error } = await supabase.rpc('book_session', {
        p_session_id: sessionId,
        p_participant_id: participantId,
        p_actor: actorLabel(req),
      });
      if (error) {
        return sendDatabaseError(res, error, {
          context: 'book_session',
          alreadyExistsKey: 'already_booked',
        });
      }

      return res.json({ ok: true, booking: publicBooking(data) });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/bookings/:bookingId/cancel', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const bookingId = parseUuid(req.params.bookingId);
      if (!bookingId) return res.status(400).json({ ok: false, error: 'invalid_booking_id' });

      const { data, error } = await supabase.rpc('cancel_booking', {
        p_booking_id: bookingId,
        p_actor: actorLabel(req),
      });
      if (error) return sendDatabaseError(res, error, { context: 'cancel_booking' });

      return res.json({
        ok: true,
        booking: publicBooking(data?.booking),
        promoted: publicBooking(data?.promoted),
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/bookings/:bookingId/check-in', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const bookingId = parseUuid(req.params.bookingId);
      if (!bookingId) return res.status(400).json({ ok: false, error: 'invalid_booking_id' });

      const { data, error } = await supabase.rpc('check_in_booking', {
        p_booking_id: bookingId,
        p_actor: actorLabel(req),
      });
      if (error) return sendDatabaseError(res, error, { context: 'check_in_booking' });

      return res.json({ ok: true, booking: publicBooking(data) });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/bookings/:bookingId/no-show', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const bookingId = parseUuid(req.params.bookingId);
      if (!bookingId) return res.status(400).json({ ok: false, error: 'invalid_booking_id' });

      const { data, error } = await supabase.rpc('mark_booking_no_show', {
        p_booking_id: bookingId,
        p_actor: actorLabel(req),
      });
      if (error) return sendDatabaseError(res, error, { context: 'mark_booking_no_show' });

      return res.json({ ok: true, booking: publicBooking(data) });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
