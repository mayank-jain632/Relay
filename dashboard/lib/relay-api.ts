import { getApiBaseUrl } from './config';

interface RelayRequestOptions {
  method?: string;
  token?: string;
  adminApiKey?: string;
  body?: unknown;
}

async function relayFetch(pathname: string, options: RelayRequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  if (options.adminApiKey) {
    headers['x-admin-api-key'] = options.adminApiKey;
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const apiBase = getApiBaseUrl();
  const url = `${apiBase}${pathname}`;

  try {
    return await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store'
    });
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new Error(`Relay API request failed for ${url}. ${detail}`);
  }
}

async function parseJsonSafe(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function relayAuthStart(): Promise<{ loginId: string; loginUrl: string }> {
  const response = await relayFetch('/auth/vscode/start', { method: 'POST' });
  const data = await parseJsonSafe(response);
  if (!response.ok || !data?.loginId || !data?.loginUrl) {
    throw new Error(`Login start failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

export async function relayAuthPollToken(loginId: string): Promise<{ token: string; user: any } | null> {
  const response = await relayFetch(`/auth/github/token?loginId=${encodeURIComponent(loginId)}`);
  if (response.status === 401) {
    return null;
  }

  const data = await parseJsonSafe(response);
  if (!response.ok || !data?.token || !data?.user) {
    throw new Error(`Token poll failed: ${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

export async function relayGet(pathname: string, token: string): Promise<any> {
  const response = await relayFetch(pathname, { token });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(`GET ${pathname} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

export async function relayPost(pathname: string, token: string, body: unknown): Promise<any> {
  const response = await relayFetch(pathname, { method: 'POST', token, body });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(`POST ${pathname} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

export async function relayPatch(pathname: string, token: string, body: unknown): Promise<any> {
  const response = await relayFetch(pathname, { method: 'PATCH', token, body });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(`PATCH ${pathname} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

export async function relayAdminPost(pathname: string, adminApiKey: string, body: unknown): Promise<any> {
  const response = await relayFetch(pathname, { method: 'POST', adminApiKey, body });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(`ADMIN POST ${pathname} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}
