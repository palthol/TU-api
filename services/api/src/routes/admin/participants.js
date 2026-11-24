import {
  buildParticipantSearchOrFilter,
  parsePagination,
  parseSearchQuery,
} from '../../lib/adminRequestValidation.js';
import { mapDatabaseError, sendDatabaseError } from '../../lib/exposeSupabaseError.js';
import { nyCalendarDate } from '../../lib/gymTime.js';
import {
  parsePlaceholderCreateBody,
  publicPlaceholderParticipant,
  publicPlaceholderSubscription,
} from '../../lib/placeholderParticipant.js';

/**
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient }} ctx
 */
export function registerAdminParticipantRoutes(router, { supabase }) {
  router.get('/participants/search', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const parsedQuery = parseSearchQuery(req.query.q);
      if (!parsedQuery.ok) {
        return res.status(400).json({ ok: false, error: parsedQuery.error });
      }
      const page = parsePagination(req.query, { defaultLimit: 8, maxLimit: 25 });
      if (!page.ok) return res.status(400).json({ ok: false, error: page.error });
      const { limit } = page;

      const { data: people, error: pErr } = await supabase
        .from('participants')
        .select('id, full_name, email, cell_phone, home_phone, created_at')
        .or(buildParticipantSearchOrFilter(parsedQuery.q))
        .order('created_at', { ascending: false })
        .limit(limit);
      if (pErr) return sendDatabaseError(res, pErr, { context: 'participants.search' });

      const participantIds = (people || []).map((p) => p.id);
      let membershipRows = [];
      if (participantIds.length > 0) {
        const { data: mRows, error: mErr } = await supabase
          .from('account_members')
          .select('participant_id, account_id, role, created_at, accounts(id, status, primary_contact_name)')
          .in('participant_id', participantIds)
          .order('created_at', { ascending: false });
        if (mErr) return sendDatabaseError(res, mErr, { context: 'participants.search.memberships' });
        membershipRows = mRows || [];
      }

      const byParticipant = new Map();
      for (const row of membershipRows) {
        const list = byParticipant.get(row.participant_id) || [];
        list.push({
          account_id: row.account_id,
          role: row.role,
          account_status: row.accounts?.status ?? null,
          account_primary_contact_name: row.accounts?.primary_contact_name ?? null,
        });
        byParticipant.set(row.participant_id, list);
      }

      const rows = (people || []).map((p) => {
        const accounts = byParticipant.get(p.id) || [];
        const preferred =
          accounts.find((a) => a.account_status === 'active' && (a.role === 'payer' || a.role === 'guardian')) ||
          accounts.find((a) => a.account_status === 'active') ||
          accounts[0] ||
          null;
        return {
          participant_id: p.id,
          full_name: p.full_name,
          email: p.email,
          cell_phone: p.cell_phone,
          home_phone: p.home_phone,
          account_count: accounts.length,
          preferred_account_id: preferred?.account_id || null,
          accounts,
        };
      });

      return res.json({ ok: true, rows });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/participants/placeholders', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const parsed = parsePlaceholderCreateBody(req.body);
      if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });

      const createdBy =
        typeof req.staff?.actorLabel === 'string' && req.staff.actorLabel.trim()
          ? req.staff.actorLabel.trim()
          : 'admin_api';

      const { data, error } = await supabase.rpc('create_placeholder_participant', {
        p_first_name: parsed.value.first_name,
        p_last_name: parsed.value.last_name,
        p_placeholder_reason: parsed.value.placeholder_reason,
        p_email: parsed.value.email,
        p_phone: parsed.value.phone,
        p_date_of_birth: parsed.value.date_of_birth,
        p_dob_is_placeholder: parsed.value.dob_is_placeholder,
        p_dob_placeholder_reason: parsed.value.dob_placeholder_reason,
        p_account_id: parsed.value.account_id,
        p_account_name: parsed.value.account_name,
        p_plan_id: parsed.value.plan_id,
        p_start_date: parsed.value.plan_id
          ? parsed.value.start_date || nyCalendarDate()
          : null,
        p_created_by: createdBy,
      });
      if (error) {
        const mapped = mapDatabaseError(error, { context: 'create_placeholder_participant' });
        if (mapped.body.error === 'duplicate_name') {
          const detail = parseRpcJsonDetail(error);
          if (typeof detail.existing_participant_id === 'string') {
            mapped.body.existing_participant_id = detail.existing_participant_id;
          }
        }
        return res.status(mapped.status).json(mapped.body);
      }

      const row = data && typeof data === 'object' ? data : {};
      const participant = publicPlaceholderParticipant(row);
      if (!participant) {
        return res.status(500).json({ ok: false, error: 'internal_error' });
      }
      return res.status(201).json({
        ok: true,
        participant,
        account_id: typeof row.account_id === 'string' ? row.account_id : null,
        subscription: publicPlaceholderSubscription(row.subscription),
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/participants/merge', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const { canonical_participant_id, duplicate_participant_id } = req.body || {};
      if (!canonical_participant_id || !duplicate_participant_id) {
        return res.status(400).json({ ok: false, error: 'both_participant_ids_required' });
      }
      const { error } = await supabase.rpc('merge_participants', {
        p_canonical_participant_id: canonical_participant_id,
        p_duplicate_participant_id: duplicate_participant_id,
      });
      if (error) {
        return sendDatabaseError(res, error, { context: 'merge_participants' });
      }
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}

function parseRpcJsonDetail(error) {
  const raw = error?.details ?? error?.detail ?? '';
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
