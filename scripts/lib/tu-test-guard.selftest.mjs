/**
 * Offline checks for tu-test-guard. No network. No production writes.
 */
import {
  PRODUCTION_SUPABASE_PROJECT_REF,
  assertNonProductionTargets,
  envFileLooksLikeProduction,
  isLocalUrl,
  isProductionApiBase,
  isProductionSupabaseUrl,
  productionTargetReasons,
} from './tu-test-guard.mjs';

const prodUrl = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
const cases = [];

function check(name, fn) {
  try {
    fn();
    cases.push({ name, ok: true });
  } catch (err) {
    cases.push({ name, ok: false, detail: err.message });
  }
}

check('detects production supabase URL', () => {
  if (!isProductionSupabaseUrl(prodUrl)) throw new Error('missed project URL');
  if (!isProductionSupabaseUrl(`postgres://x@db.${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co:5432/postgres`)) {
    throw new Error('missed db host');
  }
  if (isProductionSupabaseUrl('http://127.0.0.1:54321')) throw new Error('false positive local');
});

check('detects production API hosts', () => {
  if (!isProductionApiBase('https://api.templeunderground.com')) throw new Error('missed public host');
  if (!isProductionApiBase('https://temple-underground-signup.onrender.com/api')) throw new Error('missed render host');
  if (isProductionApiBase('http://localhost:3001')) throw new Error('false positive local api');
});

check('local URLs', () => {
  if (!isLocalUrl('http://127.0.0.1:54321')) throw new Error('127.0.0.1');
  if (!isLocalUrl('http://localhost:3001')) throw new Error('localhost');
  if (isLocalUrl(prodUrl)) throw new Error('prod marked local');
});

check('refuses production even with TU_TEST_ALLOW_REMOTE=1', () => {
  const prev = process.env.TU_TEST_ALLOW_REMOTE;
  process.env.TU_TEST_ALLOW_REMOTE = '1';
  try {
    const reasons = productionTargetReasons({
      supabaseUrl: prodUrl,
      apiBase: 'https://api.templeunderground.com',
    });
    if (reasons.length < 2) throw new Error(`expected two production reasons, got ${reasons.length}`);
    let threw = false;
    try {
      assertNonProductionTargets({ supabaseUrl: prodUrl, apiBase: 'http://localhost:3001' });
    } catch (e) {
      threw = e.code === 'TU_TEST_PRODUCTION_TARGET';
    }
    if (!threw) throw new Error('assert did not throw for production supabase');
  } finally {
    if (prev === undefined) delete process.env.TU_TEST_ALLOW_REMOTE;
    else process.env.TU_TEST_ALLOW_REMOTE = prev;
  }
});

check('allows localhost without remote flag', () => {
  const prev = process.env.TU_TEST_ALLOW_REMOTE;
  delete process.env.TU_TEST_ALLOW_REMOTE;
  try {
    assertNonProductionTargets({
      supabaseUrl: 'http://127.0.0.1:54321',
      apiBase: 'http://localhost:3001',
    });
  } finally {
    if (prev !== undefined) process.env.TU_TEST_ALLOW_REMOTE = prev;
  }
});

check('refuses unmarked remote non-prod', () => {
  const prev = process.env.TU_TEST_ALLOW_REMOTE;
  delete process.env.TU_TEST_ALLOW_REMOTE;
  try {
    const reasons = productionTargetReasons({
      supabaseUrl: 'https://abcdefghijklmnop.supabase.co',
      apiBase: 'http://localhost:3001',
    });
    if (!reasons.some((r) => r.includes('not local'))) throw new Error(`expected remote refusal, got ${reasons.join('; ')}`);
  } finally {
    if (prev !== undefined) process.env.TU_TEST_ALLOW_REMOTE = prev;
  }
});

check('env file scanner', () => {
  if (!envFileLooksLikeProduction(`SUPABASE_URL=https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co\n`)) {
    throw new Error('missed ref in env file');
  }
  if (envFileLooksLikeProduction('SUPABASE_URL=http://127.0.0.1:54321\n')) {
    throw new Error('false positive env file');
  }
});

const failed = cases.filter((c) => !c.ok);
for (const c of cases) {
  console.log(`${c.ok ? 'ok' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
if (failed.length) {
  process.exitCode = 1;
} else {
  console.log(`\n${cases.length} checks passed (no network, no production writes)`);
}
