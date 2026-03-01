import * as vscode from 'vscode';
import { SidebarProvider } from './SidebarProvider';
import { Task, TaskDetailResponse, TaskListResponse } from './shared/types';
import { getCurrentUser } from './shared/userMap';
import { getWorkspaceRelativePath, normalizeFilePath, prioritizeByFile, sortByOrder } from './shared/taskUtils';
import { TaskDetailPanel } from './TaskDetailPanel';

let currentTasks: Task[] = [];
let pollHandle: NodeJS.Timeout | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const sidebar = new SidebarProvider();
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar));

  sidebar.setOnOpenTask((taskId) => {
    TaskDetailPanel.open(
      context,
      taskId,
      {
        getTaskById,
        patchTask,
        summarizeTask
      },
      async () => {
        await refreshTasks(sidebar);
      }
    );
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('contexthud.refresh', async () => {
      await refreshTasks(sidebar);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (!editor) {
        return;
      }

      const relativePath = getWorkspaceRelativePath(editor.document.uri);
      const reprioritized = prioritizeByFile(currentTasks, relativePath);
      const topTaskHasMatchingFile = (reprioritized[0]?.linkedFiles || []).some(
        (file) => normalizeFilePath(file) === normalizeFilePath(relativePath)
      );

      if (topTaskHasMatchingFile) {
        currentTasks = reprioritized;
        sidebar.updateTasks(currentTasks);
        applySubtleGlow(editor);
      }
    })
  );

  await refreshTasks(sidebar);

  pollHandle = setInterval(() => {
    void refreshTasks(sidebar);
  }, 5000);

  context.subscriptions.push({
    dispose: () => {
      if (pollHandle) {
        clearInterval(pollHandle);
      }
    }
  });
}

export function deactivate(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
  }
}

async function refreshTasks(sidebar: SidebarProvider): Promise<void> {
  const configuredUser = await getCurrentUser();

  try {
    const data = await fetchTaskList();
    const active = data.tasks.filter((task) => task.status !== 'done');

    const privateFiltered = configuredUser
      ? active.filter((task) => sameIdentity(task.assignee_id, configuredUser))
      : active;

    currentTasks = sortByOrder(privateFiltered);
    sidebar.updateTasks(currentTasks);
  } catch (error) {
    vscode.window.showErrorMessage(`ContextHUD failed to fetch tasks: ${String(error)}`);
  }
}

function normalizeIdentity(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function sameIdentity(a: string, b: string): boolean {
  return normalizeIdentity(a) === normalizeIdentity(b);
}

async function fetchTaskList(): Promise<TaskListResponse> {
  const url = buildApiUrl('/tasks');
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Task fetch failed: ${response.status}`);
  }

  return (await response.json()) as TaskListResponse;
}

async function getTaskById(taskId: string): Promise<Task> {
  const response = await fetch(buildApiUrl(`/tasks/${encodeURIComponent(taskId)}`));
  if (!response.ok) {
    throw new Error(`Task detail fetch failed: ${response.status}`);
  }

  const data = (await response.json()) as TaskDetailResponse;
  return data.task;
}

async function patchTask(taskId: string, patch: Record<string, unknown>): Promise<Task> {
  const response = await fetch(buildApiUrl(`/tasks/${encodeURIComponent(taskId)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });

  if (!response.ok) {
    throw new Error(`Task patch failed: ${response.status}`);
  }

  const data = (await response.json()) as TaskDetailResponse;
  return data.task;
}

async function summarizeTask(taskId: string): Promise<Task> {
  const response = await fetch(buildApiUrl(`/tasks/${encodeURIComponent(taskId)}/ai/summarize`), {
    method: 'POST'
  });

  if (!response.ok) {
    throw new Error(`AI summarize failed: ${response.status}`);
  }

  const data = (await response.json()) as TaskDetailResponse;
  return data.task;
}

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

function applySubtleGlow(editor: vscode.TextEditor): void {
  const maxLine = Math.min(4, editor.document.lineCount - 1);
  if (maxLine < 0) {
    return;
  }

  const range = new vscode.Range(0, 0, maxLine, editor.document.lineAt(maxLine).range.end.character);
  const opacityStops = [0.24, 0.18, 0.12, 0.06, 0.0];

  let idx = 0;
  const tick = () => {
    const opacity = opacityStops[idx];
    const localDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: `rgba(0, 153, 153, ${opacity})`,
      borderRadius: '2px'
    });

    editor.setDecorations(localDecoration, opacity > 0 ? [range] : []);
    setTimeout(() => localDecoration.dispose(), 220);

    idx += 1;
    if (idx < opacityStops.length) {
      setTimeout(tick, 180);
    }
  };

  tick();
}
