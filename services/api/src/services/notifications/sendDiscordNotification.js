const truncate = (value, limit) => {
  const text = String(value ?? 'Not provided');
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, '') + '…';
};

// One embed, at most 25 fields and 6000 aggregate characters. Reserve room
// for footer/title and stop adding fields when the available budget is spent.
export function discordPayload({ title, fields = [], footerText }) {
  const embed = { title: truncate(title, 256), color: 0x2563eb, fields: [] };
  if (footerText) embed.footer = { text: truncate(footerText, 2048) };
  let remaining = 6000 - embed.title.length - (embed.footer?.text.length ?? 0);
  for (const field of fields.slice(0, 25)) {
    const name = truncate(field.name, 256) || 'Information';
    if (remaining <= name.length) break;
    const value = truncate(field.value, Math.min(1024, remaining - name.length)) || 'Not provided';
    if (name.length + value.length > remaining) break;
    embed.fields.push({ name, value, inline: Boolean(field.inline) });
    remaining -= name.length + value.length;
  }
  return { embeds: [embed], allowed_mentions: { parse: [], users: [], roles: [], replied_user: false } };
}

/** Incoming webhook supports in-memory multipart attachments; no storage URLs.
 * Retry only explicit 429 rejections. Ambiguous network/5xx failures are not
 * automatically repeated because Discord has no webhook idempotency key.
 */
export async function sendDiscordNotification(webhookUrl, message, { timeoutMs = 3000, files = [] } = {}) {
  if (!webhookUrl || typeof webhookUrl !== 'string') throw new Error('discord_webhook_not_configured');
  if (files.length > 10) throw new Error('discord_attachment_limit');
  const payload = discordPayload(message);
  const url = new URL(webhookUrl);
  url.searchParams.set('wait', 'true');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const deadline = Date.now() + timeoutMs;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let body = JSON.stringify(payload);
      let headers = { 'Content-Type': 'application/json' };
      if (files.length) {
        body = new FormData();
        body.append('payload_json', JSON.stringify({ ...payload,
          attachments: files.map((file, id) => ({ id, filename: file.filename })) }));
        files.forEach((file, index) => body.append(`files[${index}]`,
          new Blob([file.data], { type: 'text/vcard;charset=utf-8' }), file.filename));
        // fetch supplies the multipart boundary.
        headers = undefined;
      }
      const response = await fetch(url.toString(), { method: 'POST', headers, body, signal: controller.signal });
      if (response.ok) return;
      if (response.status !== 429) throw new Error(`discord_http_${response.status}`);
      let rateLimit;
      try { rateLimit = await response.json(); } catch { rateLimit = {}; }
      const seconds = Number(rateLimit.retry_after ?? response.headers.get('retry-after') ?? NaN);
      const delay = Math.ceil(seconds * 1000);
      if (!Number.isFinite(delay) || delay < 0 || delay >= deadline - Date.now() || attempt === 2) {
        throw new Error('discord_rate_limited');
      }
      // Never retry sooner than Discord's requested delay.
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('discord_timeout');
    if (/^discord_(http_\d+|rate_limited)$/.test(error?.message)) throw error;
    throw new Error('discord_network_error');
  } finally {
    clearTimeout(timeoutId);
  }
}
