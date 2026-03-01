import * as vscode from 'vscode';
import { SidebarProvider } from './SidebarProvider';
import { Task } from './shared/types';
import { getCurrentUser } from './shared/userMap';
import { getWorkspaceRelativePath, normalizeFilePath, prioritizeByFile, sortByOrder } from './shared/taskUtils';
import { TaskDetailPanel } from './TaskDetailPanel';
import { addTaskCommit, fetchTaskList, getTaskById, patchTask, summarizeTask } from './api/client';
import {
  buildBranchName,
  buildGitHubCompareUrl,
  checkoutOrCreateBranch,
  detectBaseBranch,
  getCurrentBranch,
  getHeadSha,
  getRemoteOriginUrl,
  getRepoRoot,
  readCommit,
  showCommit
} from './git/git';
import { getActiveTaskId, setActiveTaskId } from './state/activeTask';

let currentTasks: Task[] = [];
let refreshPollHandle: NodeJS.Timeout | undefined;
let commitPollHandle: NodeJS.Timeout | undefined;
const lastSeenCommitByTask = new Map<string, string>();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const sidebar = new SidebarProvider();
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar));

  maybeShowSecondarySidebarOnboarding(context);

  sidebar.setOnOpenTask((taskId) => {
    void setActiveTaskId(context.workspaceState, taskId);
    TaskDetailPanel.open(
      context,
      taskId,
      {
        getTaskById,
        patchTask,
        summarizeTask,
        startTask,
        openPr,
        openCommit
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

  refreshPollHandle = setInterval(() => {
    void refreshTasks(sidebar);
  }, 5000);

  startCommitLinkPolling(context, sidebar);

  context.subscriptions.push({
    dispose: () => {
      if (refreshPollHandle) {
        clearInterval(refreshPollHandle);
      }
      if (commitPollHandle) {
        clearInterval(commitPollHandle);
      }
    }
  });
}

export function deactivate(): void {
  if (refreshPollHandle) {
    clearInterval(refreshPollHandle);
  }
  if (commitPollHandle) {
    clearInterval(commitPollHandle);
  }
}

function maybeShowSecondarySidebarOnboarding(context: vscode.ExtensionContext): void {
  const key = 'contexthud.onboarding.secondarySidebar.v1';
  const seen = context.globalState.get<boolean>(key, false);
  if (seen) {
    return;
  }

  void context.globalState.update(key, true);
  void vscode.window.showInformationMessage(
    'Relay tip: move ContextHUD to the right side. Right-click the ContextHUD view title -> Move View -> Secondary Side Bar.'
  );
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

async function startTask(taskId: string): Promise<Task> {
  const task = await getTaskById(taskId);
  const repoRoot = await getRepoRoot();
  const prefix = vscode.workspace.getConfiguration('contexthud').get<string>('git.branchPrefix', 'ch');
  const branchName = buildBranchName(prefix || 'ch', task.id, task.title || task.description);

  const result = await checkoutOrCreateBranch(repoRoot, branchName);
  const updated = await patchTask(taskId, {
    branchName,
    status: 'in_progress'
  });

  vscode.window.showInformationMessage(
    result.created
      ? `Started task and created branch ${branchName}`
      : `Started task and switched to existing branch ${branchName}`
  );

  return updated;
}

async function openPr(taskId: string): Promise<void> {
  const task = await getTaskById(taskId);
  if (!task.branchName) {
    vscode.window.showWarningMessage('Start the task first to create/switch branch before opening PR.');
    return;
  }

  const repoRoot = await getRepoRoot();
  const remote = await getRemoteOriginUrl(repoRoot);
  const configuredBase = vscode.workspace.getConfiguration('contexthud').get<string>('git.baseBranch', 'main') || 'main';
  const baseBranch = await detectBaseBranch(repoRoot, configuredBase);
  const compareUrl = buildGitHubCompareUrl(remote, baseBranch, task.branchName);

  if (!compareUrl) {
    vscode.window.showWarningMessage('Open PR currently supports GitHub remotes only.');
    return;
  }

  await vscode.env.openExternal(vscode.Uri.parse(compareUrl));
}

async function openCommit(sha: string): Promise<void> {
  const repoRoot = await getRepoRoot();
  const content = await showCommit(repoRoot, sha);
  const doc = await vscode.workspace.openTextDocument({
    language: 'diff',
    content
  });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active, true);
}

function startCommitLinkPolling(context: vscode.ExtensionContext, sidebar: SidebarProvider): void {
  const intervalSec = Math.max(
    5,
    Number(vscode.workspace.getConfiguration('contexthud').get<number>('git.commitPollIntervalSec', 15))
  );

  commitPollHandle = setInterval(() => {
    void pollActiveTaskCommit(context, sidebar);
  }, intervalSec * 1000);
}

async function pollActiveTaskCommit(context: vscode.ExtensionContext, sidebar: SidebarProvider): Promise<void> {
  const activeTaskId = getActiveTaskId(context.workspaceState);
  if (!activeTaskId) {
    return;
  }

  try {
    const task = await getTaskById(activeTaskId);
    if (!task.branchName) {
      return;
    }

    const repoRoot = await getRepoRoot();
    const currentBranch = await getCurrentBranch(repoRoot);
    if (currentBranch !== task.branchName) {
      return;
    }

    const sha = await getHeadSha(repoRoot);
    if (!sha || lastSeenCommitByTask.get(activeTaskId) === sha) {
      return;
    }

    if (task.commits?.some((commit) => commit.sha === sha)) {
      lastSeenCommitByTask.set(activeTaskId, sha);
      return;
    }

    const commit = await readCommit(repoRoot, sha);
    await addTaskCommit(activeTaskId, commit);
    lastSeenCommitByTask.set(activeTaskId, sha);
    await refreshTasks(sidebar);
  } catch {
    // best-effort polling; keep silent to avoid noisy UX
  }
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
