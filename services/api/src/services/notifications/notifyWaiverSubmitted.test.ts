import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildWaiverSubmittedNotification,
  notifyWaiverSubmitted,
} from './notifyWaiverSubmitted.js';

const originalDiscordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
const originalSlackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

const restoreEnv = (key: 'DISCORD_WEBHOOK_URL' | 'SLACK_WEBHOOK_URL', value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

afterEach(() => {
  restoreEnv('DISCORD_WEBHOOK_URL', originalDiscordWebhookUrl);
  restoreEnv('SLACK_WEBHOOK_URL', originalSlackWebhookUrl);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildWaiverSubmittedNotification', () => {
  it('includes waiver details and admin reference', () => {
    const message = buildWaiverSubmittedNotification({
      waiverId: 'waiver-123',
      participant: {
        full_name: 'John Smith',
        phone: '555-555-5555',
        email: 'john@example.com',
      },
      submittedAt: '2026-05-09T23:45:00.000Z',
    });

    expect(message.title).toBe('New Waiver Submitted');
    expect(message.fields).toContainEqual({ name: 'Full Name', value: 'John Smith' });
    expect(message.fields).toContainEqual({ name: 'Phone', value: '555-555-5555' });
    expect(message.fields).toContainEqual({ name: 'Email', value: 'john@example.com' });
    expect(message.fields).toContainEqual({ name: 'Waiver ID', value: 'waiver-123' });
    expect(message.fields).toContainEqual({
      name: 'Admin Reference',
      value: '/api/admin/waivers/waiver-123',
    });
  });
});

describe('notifyWaiverSubmitted', () => {
  it('sends only to configured providers', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.example/webhook';
    delete process.env.SLACK_WEBHOOK_URL;
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const results = await notifyWaiverSubmitted({
      waiverId: 'waiver-123',
      participantId: 'participant-123',
      participant: { full_name: 'John Smith', phone: '555-555-5555', email: 'john@example.com' },
      submittedAt: '2026-05-09T23:45:00.000Z',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(results).toEqual([{ provider: 'discord', ok: true }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.example/webhook',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('logs provider failures without throwing', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.example/webhook';
    process.env.SLACK_WEBHOOK_URL = 'https://slack.example/webhook';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('bad webhook', { status: 500 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const results = await notifyWaiverSubmitted({
      waiverId: 'waiver-123',
      participantId: 'participant-123',
      participant: { full_name: 'John Smith', phone: '555-555-5555', email: 'john@example.com' },
      submittedAt: '2026-05-09T23:45:00.000Z',
      logger,
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ provider: 'discord', ok: false });
    expect(results[1]).toEqual({ provider: 'slack', ok: true });
    expect(logger.error).toHaveBeenCalledWith(
      'waiver.notification.failed',
      expect.objectContaining({ provider: 'discord', waiverId: 'waiver-123' }),
    );
  });
});
