import { describe, expect, it } from 'vitest';
import {
  PLACEHOLDER_DATE_OF_BIRTH,
  parsePlaceholderCreateBody,
} from './placeholderParticipant.js';

const valid = {
  first_name: 'Casey',
  last_name: 'Placeholder',
  placeholder_reason: 'name only; no waiver yet',
  date_of_birth: '1990-05-05',
};

describe('parsePlaceholderCreateBody', () => {
  it('accepts a real DOB without the stand-in flag', () => {
    const parsed = parsePlaceholderCreateBody(valid);
    expect(parsed).toEqual({
      ok: true,
      value: expect.objectContaining({
        first_name: 'Casey',
        last_name: 'Placeholder',
        date_of_birth: '1990-05-05',
        dob_is_placeholder: false,
        dob_placeholder_reason: null,
        plan_id: null,
      }),
    });
  });

  it('fills the documented stand-in DOB when the flag is set', () => {
    const parsed = parsePlaceholderCreateBody({
      ...valid,
      date_of_birth: undefined,
      dob_is_placeholder: true,
      dob_placeholder_reason: 'DOB unknown at desk',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.date_of_birth).toBe(PLACEHOLDER_DATE_OF_BIRTH);
      expect(parsed.value.dob_is_placeholder).toBe(true);
    }
  });

  it('rejects the stand-in date unless the flag is set', () => {
    const parsed = parsePlaceholderCreateBody({
      ...valid,
      date_of_birth: PLACEHOLDER_DATE_OF_BIRTH,
    });
    expect(parsed).toEqual({ ok: false, error: 'dob_is_placeholder_required' });
  });

  it('rejects missing DOB without the stand-in flag', () => {
    const { date_of_birth: _dob, ...rest } = valid;
    expect(parsePlaceholderCreateBody(rest)).toEqual({
      ok: false,
      error: 'date_of_birth_required',
    });
  });

  it('rejects a stand-in flag without a reason', () => {
    expect(
      parsePlaceholderCreateBody({
        ...valid,
        dob_is_placeholder: true,
      }),
    ).toEqual({ ok: false, error: 'dob_placeholder_reason_required' });
  });

  it('rejects both account_id and account_name', () => {
    expect(
      parsePlaceholderCreateBody({
        ...valid,
        account_id: '11111111-1111-4111-8111-111111111111',
        account_name: 'Household',
      }),
    ).toEqual({ ok: false, error: 'account_id_xor_account_name' });
  });

  it('rejects start_date without plan_id', () => {
    expect(
      parsePlaceholderCreateBody({
        ...valid,
        start_date: '2026-11-01',
      }),
    ).toEqual({ ok: false, error: 'plan_id_required' });
  });

  it('rejects short names and blank reasons', () => {
    expect(parsePlaceholderCreateBody({ ...valid, first_name: 'C' })).toEqual({
      ok: false,
      error: 'invalid_first_name',
    });
    expect(parsePlaceholderCreateBody({ ...valid, placeholder_reason: '  ' })).toEqual({
      ok: false,
      error: 'placeholder_reason_required',
    });
  });
});
