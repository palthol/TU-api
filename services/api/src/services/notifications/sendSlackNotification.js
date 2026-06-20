const SLACK_TEXT_LIMIT = 3000;
const SLACK_HEADER_LIMIT = 150;

const truncate = (value, limit) => {
  const text = String(value ?? 'Not provided');
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
};

/**
 * Send a Slack incoming webhook notification with block formatting.
 */
export async function sendSlackNotification(webhookUrl, { title, fields, footerText }, { timeoutMs = 3000 } = {}) {
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    throw new Error('slack_webhook_not_configured');
  }

  const fallbackLines = [
    title,
    ...(fields ?? []).map((field) => `${field.name}: ${field.value ?? 'Not provided'}`),
  ];

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: truncate(title, SLACK_HEADER_LIMIT),
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: (fields ?? []).map((field) => ({
        type: 'mrkdwn',
        text: truncate(`*${field.name}*\n${field.value ?? 'Not provided'}`, 2000),
      })),
    },
  ];

  if (footerText) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: truncate(footerText, 2000) }],
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        text: truncate(fallbackLines.join('\n'), SLACK_TEXT_LIMIT),
        blocks,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`slack_timeout_${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`slack_http_${res.status}: ${truncate(text, 500)}`);
  }
}
