import { describe, expect, it } from 'vitest';
import { parseAllowedOriginsEnv } from './index.js';

describe('CORS allowed origin parsing', () => {
  it('treats missing/empty values as wildcard', () => {
    expect(parseAllowedOriginsEnv(undefined)).toEqual({ mode: 'any' });
    expect(parseAllowedOriginsEnv('')).toEqual({ mode: 'any' });
    expect(parseAllowedOriginsEnv('   ')).toEqual({ mode: 'any' });
    expect(parseAllowedOriginsEnv('*')).toEqual({ mode: 'any' });
  });

  it('accepts a single origin', () => {
    expect(parseAllowedOriginsEnv('https://example.com')).toEqual({
      mode: 'list',
      origins: ['https://example.com'],
    });
  });

  it('accepts comma-separated origins (trimmed)', () => {
    expect(parseAllowedOriginsEnv('https://a.test, https://b.test')).toEqual({
      mode: 'list',
      origins: ['https://a.test', 'https://b.test'],
    });
  });

  it('treats any list including * as wildcard', () => {
    expect(parseAllowedOriginsEnv('https://a.test, *')).toEqual({ mode: 'any' });
  });
});

