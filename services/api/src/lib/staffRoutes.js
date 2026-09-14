import {
  generateStaffKey,
  hashStaffKey,
  isStaffRole,
  isValidStaffEmail,
  publicStaffView,
  staffKeyPrefix,
} from './staffAuth.js';

function requireRole(...roles) {
  const allowed = new Set(roles);
  return function requireRoleMiddleware(req, res, next) {
    const role = req.staff?.role;
    if (!role || !allowed.has(role)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    return next();
  };
}

function staffRowPublic(row) {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    key_prefix: row.key_prefix,
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at ?? null,
  };
}

async function countActiveOwners(supabase, { excludingId } = {}) {
  const { data, error } = await supabase
    .from('staff_users')
    .select('id')
    .eq('role', 'owner')
    .eq('active', true);
  if (error) throw error;
  const rows = data || [];
  if (!excludingId) return rows.length;
  return rows.filter((row) => row.id !== excludingId).length;
}

/**
 * Staff session + owner-only directory. Parent router must already run requireAdmin.
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient | null }} ctx
 */
export function registerStaffAuthRoutes(router, { supabase }) {
  router.get('/auth/me', (req, res) => {
    return res.json({ ok: true, staff: publicStaffView(req.staff) });
  });

  router.get('/staff', requireRole('owner'), async (_req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const { data, error } = await supabase
        .from('staff_users')
        .select('id, email, display_name, role, key_prefix, active, created_at, updated_at, last_used_at')
        .order('created_at', { ascending: true });
      if (error) {
        console.error('staff.list', { message: error.message });
        return res.status(500).json({ ok: false, error: 'db_error' });
      }
      return res.json({ ok: true, rows: (data || []).map(staffRowPublic) });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/staff', requireRole('owner'), async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const email = isValidStaffEmail(req.body?.email);
      const displayName =
        typeof req.body?.display_name === 'string' ? req.body.display_name.trim() : '';
      const role = typeof req.body?.role === 'string' ? req.body.role.trim() : '';
      if (!email) return res.status(400).json({ ok: false, error: 'invalid_email' });
      if (!displayName || displayName.length > 200) {
        return res.status(400).json({ ok: false, error: 'invalid_display_name' });
      }
      if (!isStaffRole(role)) return res.status(400).json({ ok: false, error: 'invalid_role' });

      const plaintext = generateStaffKey();
      const { data, error } = await supabase
        .from('staff_users')
        .insert({
          email,
          display_name: displayName,
          role,
          key_hash: hashStaffKey(plaintext),
          key_prefix: staffKeyPrefix(plaintext),
          active: true,
          created_by_staff_id: req.staff?.id ?? null,
        })
        .select('id, email, display_name, role, key_prefix, active, created_at, updated_at, last_used_at')
        .single();
      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ ok: false, error: 'email_taken' });
        }
        console.error('staff.insert', { message: error.message });
        return res.status(500).json({ ok: false, error: 'db_error' });
      }
      return res.json({ ok: true, staff: staffRowPublic(data), api_key: plaintext });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.patch('/staff/:id', requireRole('owner'), async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
      if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' });

      const { data: existing, error: loadError } = await supabase
        .from('staff_users')
        .select('id, email, display_name, role, key_prefix, active, created_at, updated_at, last_used_at')
        .eq('id', id)
        .maybeSingle();
      if (loadError) {
        console.error('staff.load', { message: loadError.message });
        return res.status(500).json({ ok: false, error: 'db_error' });
      }
      if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });

      const patch = {};
      if (req.body?.display_name != null) {
        const displayName =
          typeof req.body.display_name === 'string' ? req.body.display_name.trim() : '';
        if (!displayName || displayName.length > 200) {
          return res.status(400).json({ ok: false, error: 'invalid_display_name' });
        }
        patch.display_name = displayName;
      }
      if (req.body?.role != null) {
        const role = typeof req.body.role === 'string' ? req.body.role.trim() : '';
        if (!isStaffRole(role)) return res.status(400).json({ ok: false, error: 'invalid_role' });
        patch.role = role;
      }
      if (req.body?.active != null) {
        if (typeof req.body.active !== 'boolean') {
          return res.status(400).json({ ok: false, error: 'invalid_active' });
        }
        patch.active = req.body.active;
      }

      const nextRole = patch.role ?? existing.role;
      const nextActive = patch.active ?? existing.active;
      const wouldRemainOwner = nextRole === 'owner' && nextActive === true;
      if (existing.role === 'owner' && existing.active && !wouldRemainOwner) {
        const remaining = await countActiveOwners(supabase, { excludingId: existing.id });
        if (remaining < 1) {
          return res.status(409).json({ ok: false, error: 'last_owner' });
        }
      }

      let plaintext = null;
      if (req.body?.rotate_key === true) {
        plaintext = generateStaffKey();
        patch.key_hash = hashStaffKey(plaintext);
        patch.key_prefix = staffKeyPrefix(plaintext);
      }

      if (!Object.keys(patch).length) {
        return res.json({ ok: true, staff: staffRowPublic(existing) });
      }

      const { data, error } = await supabase
        .from('staff_users')
        .update(patch)
        .eq('id', id)
        .select('id, email, display_name, role, key_prefix, active, created_at, updated_at, last_used_at')
        .single();
      if (error) {
        console.error('staff.update', { message: error.message });
        return res.status(500).json({ ok: false, error: 'db_error' });
      }
      const body = { ok: true, staff: staffRowPublic(data) };
      if (plaintext) body.api_key = plaintext;
      return res.json(body);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}

export { requireRole };
