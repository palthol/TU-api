/**
 * Post plain-text messages to a Discord incoming webhook.
 * @param {string} webhookUrl
 * @param {string} content
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseRetryAfterMs = (retryAfterHeader) => {
  if (!retryAfterHeader) return null;
  const asNumber = Number(retryAfterHeader);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    // Discord usually returns seconds for Retry-After.
    return Math.round(asNumber * 1000);
  }
  const asDate = Date.parse(retryAfterHeader);
  if (Number.isFinite(asDate)) {
    const diff = asDate - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
};

const getHeaderSnapshot = (headers) => ({
  retryAfter: headers.get('retry-after') ?? null,
  xRateLimitRemaining: headers.get('x-ratelimit-remaining') ?? null,
  xRateLimitResetAfter: headers.get('x-ratelimit-reset-after') ?? null,
  xRateLimitGlobal: headers.get('x-ratelimit-global') ?? null,
  cfRay: headers.get('cf-ray') ?? null,
});

export async function postDiscordWebhook(webhookUrl, content) {
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    throw new Error('discord_webhook_not_configured');
  }
  const body = { content: content.slice(0, 2000) };
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return;

    const textBody = await res.text();
    const headers = getHeaderSnapshot(res.headers);
    const errorPreview = textBody.slice(0, 400);
    console.error('discord.webhook.failed', {
      attempt,
      maxAttempts,
      status: res.status,
      headers,
      bodyPreview: errorPreview,
    });

    if (res.status === 429 && attempt < maxAttempts) {
      const retryAfterMs = parseRetryAfterMs(headers.retryAfter) ?? 1500 * attempt;
      await sleep(Math.min(retryAfterMs, 10_000));
      continue;
    }

    throw new Error(`discord_http_${res.status}: ${errorPreview}`);
  }
}
