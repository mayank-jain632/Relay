import * as vscode from 'vscode';
import { SidebarProvider } from './SidebarProvider';
import { Task, TaskListResponse } from './shared/types';
import { getCurrentUser } from './shared/userMap';
import { getWorkspaceRelativePath, prioritizeByFile, privateFilter, sortByOrder } from './shared/taskUtils';

let currentTasks: Task[] = [];
let pollHandle: NodeJS.Timeout | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const sidebar = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar)
  );

  sidebar.setOnDoneTask(async (taskId: string) => {
    try {
      await markTaskDone(taskId);
      await refreshTasks(sidebar);
    } catch (error) {
      vscode.window.showErrorMessage(`ContextHUD failed to mark task complete: ${String(error)}`);
    }
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
      const movedToTop = reprioritized[0]?.filePath?.toLowerCase() === relativePath.toLowerCase();

      if (movedToTop) {
        currentTasks = reprioritized;
        sidebar.updateTasks(currentTasks);
        applySubtleGlow(editor);
      }
    })
  );

  await refreshTasks(sidebar);
  connectRealtime(sidebar, context);
}

export function deactivate(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
  }
}

async function refreshTasks(sidebar: SidebarProvider): Promise<void> {
  const currentUser = await getCurrentUser();
  const apiBaseUrl = vscode.workspace.getConfiguration('contexthud').get<string>('apiBaseUrl', 'http://localhost:8787');

  if (!currentUser) {
    currentTasks = [];
    sidebar.updateTasks([]);
    return;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/tasks`);
    if (!response.ok) {
      throw new Error(`Task fetch failed: ${response.status}`);
    }

    const data = (await response.json()) as TaskListResponse;
    const pendingOnly = data.tasks.filter((task) => task.status === 'pending');
    currentTasks = sortByOrder(privateFilter(pendingOnly, currentUser));
    sidebar.updateTasks(currentTasks);
  } catch (error) {
    vscode.window.showErrorMessage(`ContextHUD failed to fetch tasks: ${String(error)}`);
  }
}

async function markTaskDone(taskId: string): Promise<void> {
  const apiBaseUrl = vscode.workspace.getConfiguration('contexthud').get<string>('apiBaseUrl', 'http://localhost:8787');

  const response = await fetch(`${apiBaseUrl}/tasks/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ taskId })
  });

  if (!response.ok) {
    throw new Error(`Task complete failed: ${response.status}`);
  }
}

function connectRealtime(sidebar: SidebarProvider, context: vscode.ExtensionContext): void {
  // Polling-only mode for extension host stability on Node runtime changes.
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
