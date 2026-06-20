import { describe, expect, it, vi } from 'vitest';
import { createRequireAdminOrCron } from './requireAdminOrCron.js';

describe('requireAdminOrCron', () => {
  it('calls next when cron secret matches', () => {
    const original = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'cron-test-secret';
    const requireAdmin = vi.fn();
    const middleware = createRequireAdminOrCron(requireAdmin);
    const next = vi.fn();
    const req = { header: (name) => (name === 'x-cron-secret' ? 'cron-test-secret' : undefined) };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(requireAdmin).not.toHaveBeenCalled();
    process.env.CRON_SECRET = original;
  });

  it('delegates to requireAdmin when cron secret missing', () => {
    const original = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    const requireAdmin = vi.fn((_req, _res, next) => next());
    const middleware = createRequireAdminOrCron(requireAdmin);
    const next = vi.fn();
    const req = { header: () => undefined };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    middleware(req, res, next);

    expect(requireAdmin).toHaveBeenCalled();
    process.env.CRON_SECRET = original;
  });
});
