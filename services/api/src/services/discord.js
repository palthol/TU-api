/**
 * Post plain-text messages to a Discord incoming webhook.
 * @param {string} webhookUrl
 * @param {string} content
 */
export async function postDiscordWebhook(webhookUrl, content) {
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    throw new Error('discord_webhook_not_configured');
  }
  const body = { content: content.slice(0, 2000) };
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`discord_http_${res.status}: ${t}`);
  }
}
