const DEFAULT_API_BASE_URL = 'https://api.templeunderground.com';

function requiredEnv(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`missing_required_binding:${name}`);
  }
  return value.trim();
}

async function runBillingGeneration(env, source, scheduledTime) {
  const apiBaseUrl = (env.API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '');
  const cronSecret = requiredEnv(env.CRON_SECRET, 'CRON_SECRET');
  const response = await fetch(`${apiBaseUrl}/api/admin/billing/generate-monthly-charges`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cron-secret': cronSecret,
      'user-agent': 'temple-underground-billing-cron/1.0',
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`billing_generation_failed: status=${response.status} body=${body.slice(0, 500)}`);
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error('billing_generation_invalid_json_response');
  }

  if (payload?.ok !== true) {
    throw new Error(`billing_generation_unsuccessful: ${body.slice(0, 500)}`);
  }

  console.log(JSON.stringify({
    event: 'billing_generation_succeeded',
    source,
    scheduled_time: scheduledTime,
    created: payload.created ?? null,
    charge_ids: Array.isArray(payload.charge_ids) ? payload.charge_ids : [],
  }));
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runBillingGeneration(env, 'scheduled', new Date(controller.scheduledTime).toISOString()),
    );
  },

  async fetch() {
    // This worker is schedule-only. A manual HTTP request is never allowed to
    // create charges; use the protected API endpoint from an operator machine.
    return new Response('Not found', { status: 404 });
  },
};
