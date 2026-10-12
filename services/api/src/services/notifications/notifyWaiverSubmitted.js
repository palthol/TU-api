import { sendDiscordNotification } from './sendDiscordNotification.js';
import { sendSlackNotification } from './sendSlackNotification.js';
import { buildContactFiles } from './waiverContacts.js';
import { buildWaiverSubmittedNotification, discordText } from './waiverSummary.js';
export { buildWaiverSubmittedNotification } from './waiverSummary.js';

const EVENT_NAME = 'waiver.submitted';

const formatSubmittedAt = (value) => {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
};

function buildSlackWaiverNotification({
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

/** Process-local delivery receipts contain identifiers only, never waiver data.
 * Replays coalesce while running and retry only unsuccessful message parts.
 * No durable job exists: HTTP duplicate submissions still never re-notify.
 */
export function createWaiverNotifier({ retentionMs = 24 * 60 * 60 * 1000, maxEntries = 1000 } = {}) {
  const receipts = new Map();
  return async function notify({ waiverId, participantId, participant, submittedAt,
    emergencyContacts = [], medicalInformation, timeoutMs = 3000, logger = console }) {
    if (!waiverId) throw new Error('persisted_waiver_id_required');
    for (const [key, entry] of receipts) {
      if (!entry.running && Date.now() - entry.createdAt > retentionMs) receipts.delete(key);
    }
    let entry = receipts.get(waiverId);
    if (entry?.running) return entry.running;
    if (!entry) {
      if (receipts.size >= maxEntries) {
        // Keep existing receipts instead of evicting and silently double-posting.
        logger.error('waiver.notification.capacity_exceeded', { waiverId, participantId });
        return [{ provider: 'discord', ok: false, error: 'delivery_capacity_exceeded' }];
      }
      entry = { createdAt: Date.now(), delivered: new Set(), running: null };
      receipts.set(waiverId, entry);
    }
    const run = async () => {
      const results = [];
      const deliver = async (provider, part, send) => {
        const key = `${provider}:${part}`;
        if (entry.delivered.has(key)) {
          results.push({ provider, part, ok: true, skipped: true });
          return;
        }
        const metadata = { eventName: EVENT_NAME, provider, part, waiverId, participantId };
        logger.info('waiver.notification.attempt', metadata);
        try {
          await send();
          entry.delivered.add(key);
          logger.info('waiver.notification.sent', metadata);
          results.push({ provider, part, ok: true });
        } catch (error) {
          // Never log network error text, webhook URLs, Discord response bodies,
          // or attachment contents. Known transport errors contain no PII.
          const code = /^discord_(http_\d+|timeout|network_error|rate_limited|webhook_not_configured)$/.test(error?.message)
            ? error.message : 'notification_delivery_failed';
          logger.error('waiver.notification.failed', { ...metadata, error: code });
          results.push({ provider, part, ok: false, error: code });
        }
      };
      const discord = process.env.DISCORD_WEBHOOK_URL;
      const slack = process.env.SLACK_WEBHOOK_URL;
      if (!discord && !slack) logger.warn('waiver.notification.no_providers_configured', { waiverId, participantId });
      if (discord) {
        await deliver('discord', 'summary', () => sendDiscordNotification(discord,
          buildWaiverSubmittedNotification({ participant, emergencyContacts, medicalInformation }), { timeoutMs }));
        await deliver('discord', 'contacts', () => {
          const files = buildContactFiles(participant, emergencyContacts);
          return sendDiscordNotification(discord, {
            title: `Contacts Ready — ${discordText(participant?.full_name)}`,
            fields: files.map((file) => ({ name: file.role, value: discordText(file.filename) })),
            footerText: files.length ? 'Import each contact separately into your phone.' : 'No named contacts were provided.',
          }, { timeoutMs, files });
        });
      }
      // Preserve the existing Slack notification layout and single-message flow.
      if (slack) await deliver('slack', 'summary', () => sendSlackNotification(slack,
        buildSlackWaiverNotification({ waiverId, participant, submittedAt }), { timeoutMs }));
      return results;
    };
    entry.running = run();
    try { return await entry.running; } finally { entry.running = null; }
  };
}

export const notifyWaiverSubmitted = createWaiverNotifier();
