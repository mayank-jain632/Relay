import { RelayUser, Task, TaskDetailResponse, TaskListResponse } from '../shared/types';
import { GitCommit } from '../git/git';

export interface ApiContext {
  apiBaseUrl: string;
  projectId: string;
}

export interface PairVerifyResponse {
  ok: boolean;
  apiBaseUrl: string;
  projectId: string;
  baseBranch?: string;
}

let authToken: string | undefined;
let apiContext: ApiContext | undefined;

function normalizeApiBaseUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return 'http://localhost:8787';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/$/, '');
  }

  return `http://${trimmed}`.replace(/\/$/, '');
}

export function setApiContext(context: ApiContext): void {
  apiContext = {
    apiBaseUrl: normalizeApiBaseUrl(context.apiBaseUrl),
    projectId: String(context.projectId || '').trim()
  };
}

export function clearApiContext(): void {
  apiContext = undefined;
}

export function getApiContext(): ApiContext | undefined {
  return apiContext;
}

function requireApiContext(): ApiContext {
  if (!apiContext?.projectId) {
    throw new Error('Relay project config is missing. Initialize .relay/config.json (or legacy .contexthud/config.json).');
  }

  return apiContext;
}

function buildApiUrl(pathname: string): string {
  const context = requireApiContext();
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${context.apiBaseUrl}${normalizedPath}`;
}

function buildAuthUrl(pathname: string): string {
  const base = apiContext?.apiBaseUrl || 'http://localhost:8787';
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${normalizeApiBaseUrl(base)}${normalizedPath}`;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function apiFetch(pathname: string, options: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers || {})
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(buildApiUrl(pathname), {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
}

async function authFetch(pathname: string, options: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers || {})
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(buildAuthUrl(pathname), {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
}

export function setAuthToken(token: string | undefined): void {
  authToken = token || undefined;
}

export function getAuthToken(): string | undefined {
  return authToken;
}

export async function startVscodeLogin(): Promise<{ loginId: string; loginUrl: string }> {
  const response = await authFetch('/auth/vscode/start', { method: 'POST' });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Login start failed: ${response.status}${detail ? ` - ${detail}` : ''}`);
  }

  return (await response.json()) as { loginId: string; loginUrl: string };
}

export async function pollVscodeToken(loginId: string): Promise<{ token: string; user: RelayUser }> {
  const response = await authFetch(`/auth/github/token?loginId=${encodeURIComponent(loginId)}`);
  if (!response.ok) {
    throw new Error(`Token poll failed: ${response.status}`);
  }

  return (await response.json()) as { token: string; user: RelayUser };
}

export async function fetchMe(): Promise<RelayUser> {
  const response = await authFetch('/me');
  if (!response.ok) {
    throw new Error(`Me fetch failed: ${response.status}`);
  }

  return (await response.json()) as RelayUser;
}

export async function verifyPairCode(apiBaseUrl: string, code: string): Promise<PairVerifyResponse> {
  const response = await fetch(`${normalizeApiBaseUrl(apiBaseUrl)}/pair/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ code: String(code || '').trim() })
  });

  const text = await response.text();
  let parsed: PairVerifyResponse | any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok || !parsed?.projectId) {
    throw new Error(`Pair verification failed: ${response.status}${text ? ` - ${text}` : ''}`);
  }

  return parsed as PairVerifyResponse;
}

export async function fetchTaskList(params: { assigned?: 'me' | 'all' } = {}): Promise<TaskListResponse> {
  const context = requireApiContext();
  const query = new URLSearchParams();
  if (params.assigned) {
    query.set('assigned', params.assigned);
  }

  const pathname = `/projects/${encodeURIComponent(context.projectId)}/tasks${query.toString() ? `?${query.toString()}` : ''}`;
  const response = await apiFetch(pathname);

  if (!response.ok) {
    throw new Error(`Task fetch failed: ${response.status}`);
  }

  return (await response.json()) as TaskListResponse;
}

export async function getTaskById(taskId: string): Promise<Task> {
  const context = requireApiContext();
  const response = await apiFetch(`/projects/${encodeURIComponent(context.projectId)}/tasks/${encodeURIComponent(taskId)}`);
  if (!response.ok) {
    throw new Error(`Task detail fetch failed: ${response.status}`);
  }

  const data = (await response.json()) as TaskDetailResponse;
  return data.task;
}

export async function patchTask(taskId: string, patch: Record<string, unknown>): Promise<Task> {
  const context = requireApiContext();
  const response = await apiFetch(`/projects/${encodeURIComponent(context.projectId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: patch
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Task patch failed: ${response.status}${detail ? ` - ${detail}` : ''}`);
  }

  const data = (await response.json()) as TaskDetailResponse;
  return data.task;
}

export async function addTaskCommit(taskId: string, commit: GitCommit): Promise<Task> {
  const context = requireApiContext();
  const response = await apiFetch(`/projects/${encodeURIComponent(context.projectId)}/tasks/${encodeURIComponent(taskId)}/commits`, {
    method: 'POST',
    body: commit
  });

  if (!response.ok) {
    throw new Error(`Commit link failed: ${response.status}`);
  }

  const data = (await response.json()) as TaskDetailResponse;
  return data.task;
}
