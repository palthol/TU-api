export type AdminFetchResult<T = unknown> = {
  ok: boolean;
  status: number;
  data: T;
};

export function getDefaultApiBase(): string {
  return import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:3001';
}

export async function adminFetch<T = Record<string, unknown>>(
  apiBase: string,
  adminKey: string,
  path: string,
  options: {
    method?: string;
    json?: unknown;
  } = {},
): Promise<AdminFetchResult<T>> {
  const base = apiBase.replace(/\/$/, '');
  const headers: Record<string, string> = {};
  if (adminKey.trim()) {
    headers['x-admin-key'] = adminKey.trim();
  }
  let body: string | undefined;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  const res = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers,
    body,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}
