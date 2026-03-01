import * as vscode from 'vscode';
import { Task, TaskDetailResponse, TaskListResponse } from '../shared/types';
import { GitCommit } from '../git/git';

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

export async function fetchTaskList(): Promise<TaskListResponse> {
  const response = await fetch(buildApiUrl('/tasks'));
  if (!response.ok) {
    throw new Error(`Task fetch failed: ${response.status}`);
  }
  return (await response.json()) as TaskListResponse;
}

export async function getTaskById(taskId: string): Promise<Task> {
  const response = await fetch(buildApiUrl(`/tasks/${encodeURIComponent(taskId)}`));
  if (!response.ok) {
    throw new Error(`Task detail fetch failed: ${response.status}`);
  }
  const data = (await response.json()) as TaskDetailResponse;
  return data.task;
}

export async function patchTask(taskId: string, patch: Record<string, unknown>): Promise<Task> {
  const response = await fetch(buildApiUrl(`/tasks/${encodeURIComponent(taskId)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Task patch failed: ${response.status}${detail ? ` - ${detail}` : ''}`);
  }
  const data = (await response.json()) as TaskDetailResponse;
  return data.task;
}

export async function summarizeTask(taskId: string): Promise<Task> {
  const response = await fetch(buildApiUrl(`/tasks/${encodeURIComponent(taskId)}/ai/summarize`), {
    method: 'POST'
  });
  if (!response.ok) {
    throw new Error(`AI summarize failed: ${response.status}`);
  }
  const data = (await response.json()) as TaskDetailResponse;
  return data.task;
}

export async function addTaskCommit(taskId: string, commit: GitCommit): Promise<Task> {
  const response = await fetch(buildApiUrl(`/tasks/${encodeURIComponent(taskId)}/commits`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(commit)
  });

  if (!response.ok) {
    throw new Error(`Commit link failed: ${response.status}`);
  }

  const data = (await response.json()) as TaskDetailResponse;
  return data.task;
}
