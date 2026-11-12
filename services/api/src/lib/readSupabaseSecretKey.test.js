import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSupabaseSecretKey } from './readSupabaseSecretKey.js';
import { warnIfSupabaseKeyIsNotServiceRole } from './warnIfSupabaseKeyIsNotServiceRole.js';

function unsignedJwt(role) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role, ref: 'test' })).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('readSupabaseSecretKey', () => {
  it('prefers SUPABASE_SECRET_KEY when both names are set', () => {
    expect(readSupabaseSecretKey({
      SUPABASE_SECRET_KEY: 'sb_secret_preferred',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_legacy',
    })).toBe('sb_secret_preferred');
  });

  it('falls back to SUPABASE_SERVICE_ROLE_KEY when the new name is unset', () => {
    expect(readSupabaseSecretKey({
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_legacy',
    })).toBe('sb_secret_legacy');
  });

  it('treats a blank new name as unset', () => {
    expect(readSupabaseSecretKey({
      SUPABASE_SECRET_KEY: '   ',
      SUPABASE_SERVICE_ROLE_KEY: ' legacy-jwt ',
    })).toBe('legacy-jwt');
  });

  it('returns an empty string when neither name is set', () => {
    expect(readSupabaseSecretKey({})).toBe('');
    expect(readSupabaseSecretKey({ SUPABASE_SECRET_KEY: 1, SUPABASE_SERVICE_ROLE_KEY: null })).toBe('');
  });
});

describe('warnIfSupabaseKeyIsNotServiceRole', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not warn for sb_secret_ keys, including ones that contain dots', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnIfSupabaseKeyIsNotServiceRole('sb_secret_abc.def.ghi');
    warnIfSupabaseKeyIsNotServiceRole('  sb_secret_trimmed  ');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when an sb_publishable_ key is used as the server secret', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const key = 'sb_publishable_not_a_server_secret';
    warnIfSupabaseKeyIsNotServiceRole(key);
    expect(warn).toHaveBeenCalled();
    const text = warn.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(text).toContain('sb_publishable_');
    expect(text).not.toContain(key);
  });

  it('does not warn for a service_role JWT', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnIfSupabaseKeyIsNotServiceRole(unsignedJwt('service_role'));
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns for an anon JWT and includes the role', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const token = unsignedJwt('anon');
    warnIfSupabaseKeyIsNotServiceRole(token);
    const text = warn.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(text).toContain('anon');
    expect(text).toContain('service_role');
    expect(text).not.toContain(token);
  });

  it('stays quiet for empty values and non-JWT strings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnIfSupabaseKeyIsNotServiceRole('');
    warnIfSupabaseKeyIsNotServiceRole('   ');
    warnIfSupabaseKeyIsNotServiceRole('not-a-key');
    warnIfSupabaseKeyIsNotServiceRole('a.b.c');
    expect(warn).not.toHaveBeenCalled();
  });
});
