/** Isolated WASM PostgreSQL fallback; creates a fresh in-memory DB, never opens a DB URL. */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const runtime = process.env.TU_PGLITE_ROOT;
const tapBundle = process.env.TU_PGTAP_BUNDLE;
if (!runtime || !tapBundle) throw new Error('TU_PGLITE_ROOT and TU_PGTAP_BUNDLE local paths required; see docs/validation-environment.md');
const { PGlite } = await import(pathToFileURL(resolve(runtime, 'dist/index.js')));
const { pgcrypto } = await import(pathToFileURL(resolve(runtime, 'dist/contrib/pgcrypto.js')));
const db = new PGlite({ extensions: { pgcrypto, pgtap: {
  name: 'pgtap', setup: async () => ({ bundlePath: pathToFileURL(resolve(tapBundle)) }),
} } });
let failures = 0;
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to service_role;
  `);
  const files = (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    await db.exec(await readFile(`supabase/migrations/${f}`, 'utf8'));
    console.log(`migration OK: ${f}`);
  }
  await db.exec(await readFile(`supabase/migrations/${files.at(-1)}`, 'utf8'));
  console.log('new migration reapplied: OK');
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
  for (const f of (await readdir('supabase/tests/database')).filter(f => f.endsWith('.test.sql')).sort()) {
    console.log(`suite: ${f}`);
    const result = await db.exec(await readFile(`supabase/tests/database/${f}`, 'utf8'));
    for (const statement of result) for (const row of statement.rows) for (const value of Object.values(row)) {
      if (typeof value === 'string' && /^(ok |not ok |1\.\.|#)/m.test(value)) {
        console.log(value);
        if (/^(not ok |# Looks like)/m.test(value)) failures++;
      }
    }
  }
  console.log('schema verification:', JSON.stringify((await db.query(`
    select c.relname, c.relrowsecurity from pg_class c
    where c.oid in ('public.billing_obligations'::regclass, 'public.billing_obligation_participants'::regclass)
  `)).rows));
  console.log(`database test failures: ${failures}`);
} catch (error) {
  console.error(error.message, error.detail ?? '', error.where ?? '');
  failures++;
} finally { await db.close(); }
process.exitCode = failures ? 1 : 0;
