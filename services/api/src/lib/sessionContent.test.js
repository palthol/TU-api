import { describe, expect, it } from 'vitest';
import {
  attachPublicSessionContent,
  parseSessionContentNotes,
  parseSessionContentVideoUrl,
  parseSessionContentVisibility,
  publicSessionContentForOccurrence,
  readPublicSessionContentRows,
} from './sessionContent.js';

const occurrence = {
  name: 'Class 1',
  starts_at: '2026-11-10T00:00:00.000Z',
};

function publicRow(overrides = {}) {
  return {
    notes: 'PUBLIC-NOTE',
    video_url: 'https://videos.example.com/class-1',
    visibility: 'public',
    starts_at: '2026-11-10T00:00:00+00:00',
    session_label: 'Class 1',
    cancelled_at: null,
    ...overrides,
  };
}

describe('session content parsers', () => {
  it('accepts https video links and rejects other schemes', () => {
    expect(parseSessionContentVideoUrl(' https://videos.example.com/a?t=1 ').value).toBe(
      'https://videos.example.com/a?t=1',
    );
    expect(parseSessionContentVideoUrl('HTTPS://videos.example.com/a').value).toBe('https://videos.example.com/a');
    expect(parseSessionContentVideoUrl(null)).toEqual({ ok: true, value: null });
    expect(parseSessionContentVideoUrl('   ')).toEqual({ ok: true, value: null });
    expect(parseSessionContentVideoUrl('http://videos.example.com/a').ok).toBe(false);
    expect(parseSessionContentVideoUrl('javascript:alert(1)').ok).toBe(false);
    expect(parseSessionContentVideoUrl('https://user:pass@videos.example.com/a').ok).toBe(false);
    expect(parseSessionContentVideoUrl('https://videos.example.com/a b').ok).toBe(false);
    expect(parseSessionContentVideoUrl(12).ok).toBe(false);
  });

  it('trims notes and accepts staff, members, and public visibility', () => {
    expect(parseSessionContentNotes('  bring water  ').value).toBe('bring water');
    expect(parseSessionContentNotes('').value).toBeNull();
    expect(parseSessionContentNotes('x'.repeat(8001)).ok).toBe(false);
    expect(parseSessionContentVisibility('Members').value).toBe('members');
    expect(parseSessionContentVisibility('public').value).toBe('public');
    expect(parseSessionContentVisibility('staff').value).toBe('staff');
    expect(parseSessionContentVisibility('guests').ok).toBe(false);
    expect(parseSessionContentVisibility(undefined)).toEqual({ omitted: true });
  });
});

describe('public session content attachment', () => {
  it('keeps a single public match and drops members, staff, cancelled, and http video', () => {
    const rows = readPublicSessionContentRows([
      {
        notes: 'PUBLIC-NOTE',
        video_url: 'http://videos.example.com/nope',
        visibility: 'public',
        sessions: {
          starts_at: '2026-11-10T00:00:00+00:00',
          session_label: 'Class 1',
          cancelled_at: null,
        },
      },
      {
        notes: 'MEMBERS-ONLY-NOTE',
        video_url: 'https://videos.example.com/members',
        visibility: 'members',
        sessions: {
          starts_at: '2026-11-10T00:00:00.000Z',
          session_label: 'Class 1',
          cancelled_at: null,
        },
      },
    ]);
    const content = publicSessionContentForOccurrence(occurrence, rows);
    expect(content).toEqual({
      notes: 'PUBLIC-NOTE',
      video_url: null,
      visibility: 'public',
    });
    expect(JSON.stringify(content)).not.toContain('MEMBERS-ONLY-NOTE');
  });

  it('omits content when the session is cancelled, the label differs, or two sessions match', () => {
    expect(publicSessionContentForOccurrence(occurrence, [publicRow({ cancelled_at: '2026-11-01T00:00:00Z' })])).toBeNull();
    expect(publicSessionContentForOccurrence(occurrence, [publicRow({ session_label: 'Other' })])).toBeNull();
    expect(publicSessionContentForOccurrence(occurrence, [publicRow({ visibility: 'staff' })])).toBeNull();
    expect(publicSessionContentForOccurrence(occurrence, [publicRow(), publicRow({ notes: 'second' })])).toBeNull();
  });

  it('leaves unmatched occurrences without a content key', () => {
    const [first, second] = attachPublicSessionContent(
      [occurrence, { ...occurrence, name: 'Class 1', starts_at: '2026-11-17T00:00:00.000Z' }],
      [publicRow()],
    );
    expect(first.content.visibility).toBe('public');
    expect(second).not.toHaveProperty('content');
  });
});
