import { describe, expect, it } from 'vitest';
import { joinParticipantName, splitParticipantName } from './participantName.js';

describe('participantName', () => {
  it('joins first and last into full_name', () => {
    expect(joinParticipantName('Casey', 'Placeholder')).toBe('Casey Placeholder');
    expect(joinParticipantName('  Riley ', ' Gymtest ')).toBe('Riley Gymtest');
  });

  it('splits full_name on the first space', () => {
    expect(splitParticipantName('Casey Placeholder')).toEqual({
      first_name: 'Casey',
      last_name: 'Placeholder',
    });
    expect(splitParticipantName('Jordan')).toEqual({ first_name: 'Jordan', last_name: '' });
    expect(splitParticipantName('Avery Van Test')).toEqual({
      first_name: 'Avery',
      last_name: 'Van Test',
    });
  });
});
