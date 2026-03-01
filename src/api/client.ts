import * as vscode from 'vscode';
import { RelayUser, Task, TaskDetailResponse, TaskListResponse } from '../shared/types';
import { GitCommit } from '../git/git';

let authToken: string | undefined;

function getApiBaseUrl(): string {
  const raw = vscode.workspace.getConfiguration('contexthud').get<string>('apiBaseUrl', 'http://localhost:8787');
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return 'http://localhost:8787';
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/$/, '');
  }
  return `http://${trimmed}`.replace(/\/$/, '');
}

function buildApiUrl(pathname: string): string {
  const base = getApiBaseUrl();
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${base}${normalizedPath}`;
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

export function setAuthToken(token: string | undefined): void {
  authToken = token || undefined;
}

export function getAuthToken(): string | undefined {
  return authToken;
}

export async function startVscodeLogin(): Promise<{ loginId: string; loginUrl: string }> {
  const response = await apiFetch('/auth/vscode/start', { method: 'POST' });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Login start failed: ${response.status}${detail ? ` - ${detail}` : ''}`);
  }

  return (await response.json()) as { loginId: string; loginUrl: string };
}

export async function fetchMe(loginId?: string): Promise<RelayUser> {
  const headers: Record<string, string> = {};
  if (loginId) {
    headers['X-Vscode-Login-Id'] = loginId;
  }

  const response = await apiFetch('/me', { headers });
  if (!response.ok) {
    throw new Error(`Me fetch failed: ${response.status}`);
  }

  return (await response.json()) as RelayUser;
}

export async function logout(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' });
}

export async function fetchTaskList(params: { assignee?: string; assigned?: 'me' | 'all' } = {}): Promise<TaskListResponse> {
  const query = new URLSearchParams();
  if (params.assignee) {
    query.set('assignee', params.assignee);
  }
  if (params.assigned) {
    query.set('assigned', params.assigned);
  }

  const pathname = query.toString() ? `/tasks?${query.toString()}` : '/tasks';
  const response = await apiFetch(pathname);

  if (!response.ok) {
    throw new Error(`Task fetch failed: ${response.status}`);
  }

  return (await response.json()) as TaskListResponse;
}

export async function getTaskById(taskId: string): Promise<Task> {
  const response = await apiFetch(`/tasks/${encodeURIComponent(taskId)}`);
  if (!response.ok) {
    throw new Error(`Task detail fetch failed: ${response.status}`);
  }
  const data = (await response.json()) as TaskDetailResponse;
  return data.task;
}

export async function patchTask(taskId: string, patch: Record<string, unknown>): Promise<Task> {
  const response = await apiFetch(`/tasks/${encodeURIComponent(taskId)}`, {
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
  const response = await apiFetch(`/tasks/${encodeURIComponent(taskId)}/commits`, {
    method: 'POST',
    body: commit
  });

  if (!response.ok) {
    throw new Error(`Commit link failed: ${response.status}`);
  }

  const data = (await response.json()) as TaskDetailResponse;
  return data.task;
}
