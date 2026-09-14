import { describe, expect, it } from 'vitest';
import {
  AUTH_METHOD,
  canonicalAdminPath,
  hashStaffKey,
  roleAllowsRequest,
  rolesAllowedForRequest,
  safeEqualString,
} from './staffAuth.js';

describe('staffAuth helpers', () => {
  it('hashes staff keys as 64-char sha256 hex', () => {
    expect(hashStaffKey('tu_sk_example')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashStaffKey('tu_sk_example')).toBe(hashStaffKey('tu_sk_example'));
    expect(hashStaffKey('tu_sk_example')).not.toBe(hashStaffKey('other'));
  });

  it('compares secrets with equal-length timing-safe equality', () => {
    expect(safeEqualString('abc', 'abc')).toBe(true);
    expect(safeEqualString('abc', 'abd')).toBe(false);
    expect(safeEqualString('abc', 'ab')).toBe(false);
    expect(safeEqualString('', '')).toBe(false);
  });

  it('strips /api/admin from mounted and app-level paths', () => {
    expect(canonicalAdminPath({ baseUrl: '/api/admin', path: '/billing/record-payment' })).toBe(
      '/billing/record-payment',
    );
    expect(canonicalAdminPath({ baseUrl: '', path: '/api/admin/waivers/abc' })).toBe('/waivers/abc');
    expect(canonicalAdminPath({ baseUrl: '', path: '/api/waivers/abc/pdf' })).toBe('/api/waivers/abc/pdf');
  });

  it('allows finance billing writes but not scheduling or staff', () => {
    expect(roleAllowsRequest('finance', 'POST', '/billing/payment-refunds')).toBe(true);
    expect(roleAllowsRequest('finance', 'POST', '/billing/record-payment')).toBe(true);
    expect(roleAllowsRequest('finance', 'POST', '/scheduling/sessions')).toBe(false);
    expect(roleAllowsRequest('finance', 'GET', '/staff')).toBe(false);
    expect(roleAllowsRequest('finance', 'GET', '/auth/me')).toBe(true);
  });

  it('allows front_desk desk writes and record-payment, not refunds', () => {
    expect(roleAllowsRequest('front_desk', 'POST', '/scheduling/sessions')).toBe(true);
    expect(roleAllowsRequest('front_desk', 'POST', '/billing/record-payment')).toBe(true);
    expect(roleAllowsRequest('front_desk', 'POST', '/billing/payment-refunds')).toBe(false);
    expect(roleAllowsRequest('front_desk', 'POST', '/participants/merge')).toBe(false);
    expect(rolesAllowedForRequest('POST', '/billing/charge-adjustments')).toEqual(['owner', 'finance']);
  });

  it('treats owner as allowed for every route', () => {
    expect(roleAllowsRequest('owner', 'POST', '/staff')).toBe(true);
    expect(roleAllowsRequest('owner', 'POST', '/unknown-future-route')).toBe(true);
  });

  it('defaults unknown mutations to owner', () => {
    expect(rolesAllowedForRequest('POST', '/reporting/views/x')).toEqual(['owner']);
  });

  it('exports auth method constants used by the audit table check', () => {
    expect(AUTH_METHOD.LEGACY_SHARED_KEY).toBe('legacy_shared_key');
  });
});
