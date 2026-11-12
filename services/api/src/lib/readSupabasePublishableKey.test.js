import { describe, expect, it } from 'vitest';
import { readSupabasePublishableKey } from './readSupabasePublishableKey.js';

describe('readSupabasePublishableKey', () => {
  it('prefers SUPABASE_PUBLISHABLE_KEY when both names are set', () => {
    expect(readSupabasePublishableKey({
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_preferred',
      SUPABASE_ANON_KEY: 'anon-legacy',
    })).toBe('sb_publishable_preferred');
  });

  it('falls back to SUPABASE_ANON_KEY when the new name is unset or blank', () => {
    expect(readSupabasePublishableKey({
      SUPABASE_ANON_KEY: 'anon-legacy',
    })).toBe('anon-legacy');
    expect(readSupabasePublishableKey({
      SUPABASE_PUBLISHABLE_KEY: '  ',
      SUPABASE_ANON_KEY: ' anon-legacy ',
    })).toBe('anon-legacy');
  });

  it('returns an empty string when neither name is set', () => {
    expect(readSupabasePublishableKey({})).toBe('');
  });
});
