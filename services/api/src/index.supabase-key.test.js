import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return port;
}

/**
 * Start the real API entrypoint with an isolated env (no .env, no inherited keys).
 * The mock records the apikey header Supabase JS sends on the deep health query.
 */
async function startApi({ supabasePort, env }) {
  const port = await freePort();
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: apiRoot,
    env: {
      PATH: process.env.PATH,
      DOTENV_CONFIG_PATH: '/dev/null',
      PORT: String(port),
      ...env,
      ...(supabasePort ? { SUPABASE_URL: `http://127.0.0.1:${supabasePort}` } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });
  child.stdout.on('data', () => {});

  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50; i += 1) {
    if (child.exitCode !== null) {
      throw new Error(`API exited before listening (status ${child.exitCode})`);
    }
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      /* still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('API did not become ready');
  return {
    base,
    stderr: () => stderr,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      const exited = once(child, 'exit');
      const timedOut = new Promise((resolve) => setTimeout(resolve, 2000, 'timeout'));
      if ((await Promise.race([exited.then(() => 'exit'), timedOut])) === 'timeout') {
        child.kill('SIGKILL');
        await once(child, 'exit');
      }
    },
  };
}

async function withMockSupabase(run) {
  const seen = [];
  const mock = createServer((req, res) => {
    seen.push(req.headers.apikey);
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'unauthorized', code: '401' }));
  });
  const port = await listen(mock);
  try {
    await run({ port, seen });
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
}

describe('API Supabase key env', () => {
  it('uses SUPABASE_SECRET_KEY and ignores the legacy name when both are set', async () => {
    await withMockSupabase(async ({ port, seen }) => {
      const api = await startApi({
        supabasePort: port,
        env: {
          SUPABASE_SECRET_KEY: 'sb_secret_preferred',
          SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_legacy',
        },
      });
      try {
        const res = await fetch(`${api.base}/health/deep`);
        const body = await res.json();
        expect(res.status).toBe(500);
        expect(body).toEqual({ ok: false, db: false, error: 'db_unreachable' });
        expect(seen).toContain('sb_secret_preferred');
        expect(seen).not.toContain('sb_secret_legacy');
        expect(api.stderr()).not.toContain('sb_publishable_');
      } finally {
        await api.stop();
      }
    });
  }, 20000);

  it('falls back to SUPABASE_SERVICE_ROLE_KEY when the new name is blank', async () => {
    await withMockSupabase(async ({ port, seen }) => {
      const api = await startApi({
        supabasePort: port,
        env: {
          SUPABASE_SECRET_KEY: '  ',
          SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_legacy',
        },
      });
      try {
        const res = await fetch(`${api.base}/health/deep`);
        expect((await res.json()).error).toBe('db_unreachable');
        expect(seen).toContain('sb_secret_legacy');
      } finally {
        await api.stop();
      }
    });
  }, 20000);

  it('reports supabase_not_configured when neither key is set', async () => {
    const api = await startApi({ env: { SUPABASE_URL: 'http://127.0.0.1:9' } });
    try {
      const res = await fetch(`${api.base}/health/deep`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ ok: false, db: false, error: 'supabase_not_configured' });
    } finally {
      await api.stop();
    }
  }, 20000);

  it('warns on an sb_publishable_ server key and does not fall back', async () => {
    await withMockSupabase(async ({ port, seen }) => {
      const publishable = 'sb_publishable_not_a_server_secret';
      const api = await startApi({
        supabasePort: port,
        env: {
          SUPABASE_SECRET_KEY: publishable,
          SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_legacy',
        },
      });
      try {
        const res = await fetch(`${api.base}/health/deep`);
        expect((await res.json()).error).toBe('db_unreachable');
        expect(seen).toContain(publishable);
        expect(seen).not.toContain('sb_secret_legacy');
        const stderr = api.stderr();
        expect(stderr).toContain('sb_publishable_ key');
        expect(stderr).not.toContain(publishable);
      } finally {
        await api.stop();
      }
    });
  }, 20000);
});
