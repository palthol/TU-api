import { describe, expect, it } from 'vitest';
import {
  isCloudflareAccessConfigured,
  isEmailAllowedForViewer,
  isViewerDevBypassEnabled,
  parseViewerEmailAllowlist,
} from './cloudflareAccess.js';

describe('cloudflareAccess', () => {
  it('parses email allowlist', () => {
    expect(parseViewerEmailAllowlist('you@example.com, Other@Example.com')).toEqual([
      'you@example.com',
      'other@example.com',
    ]);
  });

  it('checks allowlist membership', () => {
    const allowlist = ['you@example.com'];
    expect(isEmailAllowedForViewer('you@example.com', allowlist)).toBe(true);
    expect(isEmailAllowedForViewer('other@example.com', allowlist)).toBe(false);
  });

  it('disables dev bypass when Cloudflare Access is configured', () => {
    const originalTeam = process.env.CF_ACCESS_TEAM_DOMAIN;
    const originalAud = process.env.CF_ACCESS_AUD;
    const originalBypass = process.env.WAIVER_VIEWER_DEV_BYPASS;
    process.env.CF_ACCESS_TEAM_DOMAIN = 'myteam.cloudflareaccess.com';
    process.env.CF_ACCESS_AUD = 'test-aud';
    process.env.WAIVER_VIEWER_DEV_BYPASS = 'true';
    expect(isCloudflareAccessConfigured()).toBe(true);
    expect(isViewerDevBypassEnabled()).toBe(false);
    process.env.CF_ACCESS_TEAM_DOMAIN = originalTeam;
    process.env.CF_ACCESS_AUD = originalAud;
    process.env.WAIVER_VIEWER_DEV_BYPASS = originalBypass;
  });
});
