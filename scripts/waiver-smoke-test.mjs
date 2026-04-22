import crypto from 'node:crypto';

const API_BASE_URL = process.env.WAIVER_SMOKE_API_BASE_URL || process.env.API_BASE_URL || 'http://localhost:3001';
const ADMIN_API_KEY = process.env.WAIVER_SMOKE_ADMIN_API_KEY || process.env.ADMIN_API_KEY || '';
const REQUIRE_ADMIN_CHECK = String(process.env.WAIVER_SMOKE_REQUIRE_ADMIN_CHECK || 'true') === 'true';

const tinyPngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z2wAAAABJRU5ErkJggg==';

function nowIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function plusYearsIsoDate(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function printChecklist(items) {
  console.log('Waiver smoke checklist:');
  for (const item of items) {
    const mark = item.ok ? 'x' : ' ';
    console.log(`- [${mark}] ${item.name}${item.detail ? ` (${item.detail})` : ''}`);
  }
}

async function run() {
  const checks = [];
  const runId = crypto.randomUUID().slice(0, 8);

  const payload = {
    participant: {
      full_name: `Smoke Test ${runId}`,
      date_of_birth: plusYearsIsoDate(-22),
      email: `smoke+${runId}@example.com`,
      phone: '5551234567',
      address_line: '123 Test Lane',
      city: 'Testville',
      state: 'TX',
      zip: '75001',
    },
    signature: {
      pngDataUrl: tinyPngDataUrl,
      vectorJson: [],
    },
    legal_confirmation: {
      accepted_terms: true,
      risk_initials: 'ST',
      release_initials: 'ST',
      indemnification_initials: 'ST',
      media_initials: 'ST',
    },
    review: {
      confirm_accuracy: true,
    },
    locale: 'en',
    content_version: `waiver.smoke.${nowIsoDate()}`,
  };

  const submitRes = await fetch(`${API_BASE_URL}/api/waivers/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const submitBody = await parseJsonSafe(submitRes);
  const submitOk = submitRes.ok && submitBody?.ok === true && submitBody?.waiverId;
  checks.push({
    name: 'Submit waiver',
    ok: Boolean(submitOk),
    detail: submitOk ? `waiverId=${submitBody.waiverId}` : `status=${submitRes.status}`,
  });
  if (!submitOk) {
    printChecklist(checks);
    console.error('Submit response:', submitBody);
    process.exitCode = 1;
    return;
  }

  if (!REQUIRE_ADMIN_CHECK && !ADMIN_API_KEY) {
    checks.push({
      name: 'Admin waiver retrieval',
      ok: true,
      detail: 'skipped (admin key not required)',
    });
    printChecklist(checks);
    return;
  }

  if (!ADMIN_API_KEY) {
    checks.push({
      name: 'Admin waiver retrieval',
      ok: false,
      detail: 'missing WAIVER_SMOKE_ADMIN_API_KEY / ADMIN_API_KEY',
    });
    printChecklist(checks);
    process.exitCode = 1;
    return;
  }

  const adminRes = await fetch(`${API_BASE_URL}/api/admin/waivers/${submitBody.waiverId}`, {
    headers: { 'x-admin-key': ADMIN_API_KEY },
  });
  const adminBody = await parseJsonSafe(adminRes);
  const adminOk =
    adminRes.ok &&
    adminBody?.ok === true &&
    typeof adminBody?.signatureUrl === 'string' &&
    typeof adminBody?.documentPdfUrl === 'string' &&
    typeof adminBody?.documentSha256 === 'string';

  checks.push({
    name: 'Admin waiver retrieval',
    ok: Boolean(adminOk),
    detail: adminOk ? 'signed URLs + hash returned' : `status=${adminRes.status}`,
  });

  printChecklist(checks);
  if (!adminOk) {
    console.error('Admin response:', adminBody);
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('waiver smoke test failed:', err);
  process.exitCode = 1;
});
