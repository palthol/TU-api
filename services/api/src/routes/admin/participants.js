/**
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient }} ctx
 */
export function registerAdminParticipantRoutes(router, { supabase }) {
  router.get('/participants/search', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || ''), 10) || 8, 1), 25);
      if (!q || q.length < 2) {
        return res.status(400).json({ ok: false, error: 'query_min_length_2' });
      }

      const like = `%${q}%`;
      const { data: people, error: pErr } = await supabase
        .from('participants')
        .select('id, full_name, email, cell_phone, home_phone, created_at')
        .or(`full_name.ilike.${like},email.ilike.${like},cell_phone.ilike.${like},home_phone.ilike.${like}`)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (pErr) return res.status(400).json({ ok: false, error: pErr.message });

      const participantIds = (people || []).map((p) => p.id);
      let membershipRows = [];
      if (participantIds.length > 0) {
        const { data: mRows, error: mErr } = await supabase
          .from('account_members')
          .select('participant_id, account_id, role, created_at, accounts(id, status, primary_contact_name)')
          .in('participant_id', participantIds)
          .order('created_at', { ascending: false });
        if (mErr) return res.status(400).json({ ok: false, error: mErr.message });
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
        console.error('merge_participants', error);
        return res.status(400).json({ ok: false, error: error.message });
      }
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
