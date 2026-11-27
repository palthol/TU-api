import {
  escapeIlikeLiteral,
  parseSearchQuery,
  parseUuid,
} from '../../lib/adminRequestValidation.js';
import { sendDatabaseError } from '../../lib/exposeSupabaseError.js';
import { nyCalendarDate } from '../../lib/gymTime.js';
import { splitParticipantName } from '../../lib/participantName.js';
import { isCurrentlyEffective } from '../../lib/subscriptionCurrent.js';

const ENROLLMENT_STATUSES = new Set(['enrolled', 'unenrolled', 'placeholder']);
const PARTICIPANT_COLUMNS =
  'id, full_name, is_placeholder, placeholder_reason, dob_is_placeholder, merged_into_participant_id';
const MEMBERSHIP_COLUMNS = 'participant_id, account_id, created_at, accounts(id, primary_contact_name, status)';
const SUBSCRIPTION_COLUMNS =
  'id, participant_id, account_id, status, starts_at, ends_at, created_at, plan_definition_id, plan_definitions(id, name)';

function handler(supabase, run) {
  return async (req, res) => {
    if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
    try {
      return await run(req, res);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  };
}

function preferredMembership(rows) {
  const sorted = [...rows].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  return (
    sorted.find((row) => row.accounts?.status === 'active') ||
    sorted[0] ||
    null
  );
}

function publicSubscription(row) {
  if (!row) return null;
  const plan = Array.isArray(row.plan_definitions) ? row.plan_definitions[0] : row.plan_definitions;
  return {
    id: row.id,
    plan_id: row.plan_definition_id ?? plan?.id ?? null,
    plan_name: plan?.name ?? null,
    status: row.status,
    start_date: row.starts_at ?? null,
  };
}

function parseStatusFilter(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'invalid_status' };
  const status = value.trim().toLowerCase();
  if (!ENROLLMENT_STATUSES.has(status)) return { ok: false, error: 'invalid_status' };
  return { ok: true, value: status };
}

/**
 * Read-only enrollment board. Parent router already runs requireAdmin.
 * GET is allowed for owner, finance, and front_desk.
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient | null }} ctx
 */
export function registerBillingEnrollmentBoardRoutes(router, { supabase }) {
  router.get(
    '/billing/enrollment-board',
    handler(supabase, async (req, res) => {
      const statusFilter = parseStatusFilter(req.query.status);
      if (!statusFilter.ok) {
        return res.status(400).json({ ok: false, error: statusFilter.error });
      }

      let q = null;
      if (req.query.q !== undefined && req.query.q !== null && req.query.q !== '') {
        const parsedQuery = parseSearchQuery(req.query.q);
        if (!parsedQuery.ok) {
          return res.status(400).json({ ok: false, error: parsedQuery.error });
        }
        q = parsedQuery.q;
      }

      let peopleQuery = supabase
        .from('participants')
        .select(PARTICIPANT_COLUMNS)
        .is('merged_into_participant_id', null)
        .order('full_name', { ascending: true });
      if (q) peopleQuery = peopleQuery.ilike('full_name', `%${escapeIlikeLiteral(q)}%`);

      const { data: people, error: peopleErr } = await peopleQuery;
      if (peopleErr) return sendDatabaseError(res, peopleErr, { context: 'enrollment_board.participants' });

      const participantIds = (people ?? []).map((row) => row.id).filter((id) => parseUuid(id));
      const membershipByParticipant = new Map();
      const subscriptionByParticipant = new Map();
      const waived = new Set();

      if (participantIds.length > 0) {
        const { data: memberships, error: membershipErr } = await supabase
          .from('account_members')
          .select(MEMBERSHIP_COLUMNS)
          .in('participant_id', participantIds)
          .order('created_at', { ascending: true });
        if (membershipErr) {
          return sendDatabaseError(res, membershipErr, { context: 'enrollment_board.memberships' });
        }
        for (const row of memberships ?? []) {
          const list = membershipByParticipant.get(row.participant_id) || [];
          list.push(row);
          membershipByParticipant.set(row.participant_id, list);
        }

        const { data: subscriptions, error: subErr } = await supabase
          .from('subscriptions')
          .select(SUBSCRIPTION_COLUMNS)
          .in('participant_id', participantIds)
          .eq('status', 'active')
          .order('starts_at', { ascending: false })
          .order('created_at', { ascending: false });
        if (subErr) return sendDatabaseError(res, subErr, { context: 'enrollment_board.subscriptions' });

        const today = nyCalendarDate();
        for (const row of subscriptions ?? []) {
          if (!isCurrentlyEffective(row, today)) continue;
          if (!subscriptionByParticipant.has(row.participant_id)) {
            subscriptionByParticipant.set(row.participant_id, row);
          }
        }

        const { data: waiverRows, error: waiverErr } = await supabase
          .from('waivers')
          .select('participant_id')
          .in('participant_id', participantIds);
        if (waiverErr) return sendDatabaseError(res, waiverErr, { context: 'enrollment_board.waivers' });
        for (const row of waiverRows ?? []) {
          if (row.participant_id) waived.add(row.participant_id);
        }
      }

      const allRows = (people ?? []).map((person) => {
        const names = splitParticipantName(person.full_name);
        const membership = preferredMembership(membershipByParticipant.get(person.id) || []);
        const subscription = publicSubscription(subscriptionByParticipant.get(person.id) || null);
        return {
          participant_id: person.id,
          first_name: names.first_name,
          last_name: names.last_name,
          is_placeholder: person.is_placeholder === true,
          placeholder_reason: person.placeholder_reason ?? null,
          dob_is_placeholder: person.dob_is_placeholder === true,
          waiver_signed: waived.has(person.id),
          account_id: membership?.account_id ?? null,
          account_name: membership?.accounts?.primary_contact_name ?? null,
          subscription,
        };
      });

      const counts = {
        total: allRows.length,
        enrolled: allRows.filter((row) => row.subscription).length,
        unenrolled: allRows.filter((row) => !row.subscription).length,
        placeholders: allRows.filter((row) => row.is_placeholder).length,
      };

      let rows = allRows;
      if (statusFilter.value === 'enrolled') rows = allRows.filter((row) => row.subscription);
      else if (statusFilter.value === 'unenrolled') rows = allRows.filter((row) => !row.subscription);
      else if (statusFilter.value === 'placeholder') rows = allRows.filter((row) => row.is_placeholder);

      return res.json({ ok: true, counts, rows });
    }),
  );
}
