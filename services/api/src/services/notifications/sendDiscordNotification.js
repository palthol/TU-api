const DISCORD_FIELD_LIMIT = 1024;
const DISCORD_TITLE_LIMIT = 256;

const truncate = (value, limit) => {
  const text = String(value ?? 'Not provided');
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
};

/**
 * Send a structured Discord webhook notification.
 */
export async function sendDiscordNotification(webhookUrl, { title, fields, footerText }) {
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    throw new Error('discord_webhook_not_configured');
  }

  const embedFields = (fields ?? []).map((field) => ({
    name: truncate(field.name, 256),
    value: truncate(field.value, DISCORD_FIELD_LIMIT),
    inline: Boolean(field.inline),
  }));

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [
        {
          title: truncate(title, DISCORD_TITLE_LIMIT),
          color: 0x2563eb,
          fields: embedFields,
          footer: footerText ? { text: truncate(footerText, 2048) } : undefined,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`discord_http_${res.status}: ${truncate(text, 500)}`);
  }
}
