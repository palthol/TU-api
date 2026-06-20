import { sendDiscordNotification } from './sendDiscordNotification.js';
import { sendSlackNotification } from './sendSlackNotification.js';

const EVENT_NAME = 'waiver.submitted';

const formatSubmittedAt = (value) => {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
};

export function buildWaiverSubmittedNotification({
  waiverId,
  participant,
  submittedAt,
}) {
  const adminReference = waiverId ? `/api/admin/waivers/${waiverId}` : 'Not provided';

  return {
    title: 'New Waiver Submitted',
    fields: [
      { name: 'Full Name', value: participant?.full_name ?? 'Not provided' },
      { name: 'Phone', value: participant?.phone ?? 'Not provided' },
      { name: 'Email', value: participant?.email ?? 'Not provided' },
      { name: 'Submission Time', value: formatSubmittedAt(submittedAt) },
      { name: 'Waiver ID', value: waiverId ?? 'Not provided' },
      { name: 'Admin Reference', value: adminReference },
    ],
    footerText: 'Use the admin API reference for future waiver review workflows.',
  };
}

/**
 * Fan out a waiver submission notification to configured webhook providers.
 * Provider failures are logged and returned, but never thrown to the submit path.
 */
export async function notifyWaiverSubmitted({
  waiverId,
  participantId,
  participant,
  submittedAt,
  timeoutMs = 3000,
  logger = console,
}) {
  const message = buildWaiverSubmittedNotification({ waiverId, participant, submittedAt });
  const providers = [
    {
      name: 'discord',
      webhookUrl: process.env.DISCORD_WEBHOOK_URL,
      send: sendDiscordNotification,
    },
    {
      name: 'slack',
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
      send: sendSlackNotification,
    },
  ].filter((provider) => Boolean(provider.webhookUrl));

  if (!providers.length) {
    logger.warn('waiver.notification.no_providers_configured', {
      eventName: EVENT_NAME,
      waiverId,
      participantId,
    });
    return [];
  }

  const results = await Promise.all(
    providers.map(async (provider) => {
      logger.info('waiver.notification.attempt', {
        eventName: EVENT_NAME,
        provider: provider.name,
        waiverId,
        participantId,
      });

      try {
        await provider.send(provider.webhookUrl, message, { timeoutMs });
        logger.info('waiver.notification.sent', {
          eventName: EVENT_NAME,
          provider: provider.name,
          waiverId,
          participantId,
        });
        return { provider: provider.name, ok: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('waiver.notification.failed', {
          eventName: EVENT_NAME,
          provider: provider.name,
          waiverId,
          participantId,
          error: errorMessage,
        });
        return { provider: provider.name, ok: false, error: errorMessage };
      }
    }),
  );

  return results;
}
