import * as path from 'path';
import * as vscode from 'vscode';
import { SidebarProvider } from './SidebarProvider';
import { Task } from './shared/types';
import { getWorkspaceRelativePath, normalizeFilePath, prioritizeByFile, sortByOrder } from './shared/taskUtils';
import { TaskDetailPanel } from './TaskDetailPanel';
import { addTaskCommit, fetchTaskList, getTaskById, patchTask } from './api/client';
import {
  buildBranchName,
  buildGitHubCompareUrl,
  checkoutOrCreateBranch,
  detectBaseBranch,
  getChangedFilesForCommit,
  getCurrentBranch,
  getHeadSha,
  getRemoteOriginUrl,
  getRepoRoot,
  readCommit,
  showCommitDiff,
  showTaskDiff
} from './git/git';
import { getActiveTaskId, setActiveTaskId } from './state/activeTask';

let currentTasks: Task[] = [];
let refreshPollHandle: NodeJS.Timeout | undefined;
let commitPollHandle: NodeJS.Timeout | undefined;
const lastSeenCommitByTask = new Map<string, string>();
const linkedFilesPatchTimerByTask = new Map<string, NodeJS.Timeout>();
const repoRootCacheByWorkspace = new Map<string, string | null>();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const sidebar = new SidebarProvider();
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar));

  maybeShowSecondarySidebarOnboarding(context);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      repoRootCacheByWorkspace.clear();
    })
  );

  sidebar.setOnOpenTask((taskId) => {
    void setActiveTaskId(context.workspaceState, taskId);
    TaskDetailPanel.open(
      context,
      taskId,
      {
        getTaskById,
        patchTask,
        startTask,
        openPr,
        viewCommitDiff,
        viewTaskDiffForTask,
        openChangedFile,
        openAllChangedFiles,
        addCurrentFileToTask,
        copyFileList
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
      for (const timer of linkedFilesPatchTimerByTask.values()) {
        clearTimeout(timer);
      }
      linkedFilesPatchTimerByTask.clear();
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
  for (const timer of linkedFilesPatchTimerByTask.values()) {
    clearTimeout(timer);
  }
  linkedFilesPatchTimerByTask.clear();
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

function getConfiguredHandle(): string | undefined {
  const handle = vscode.workspace.getConfiguration('contexthud').get<string>('user.handle', '').trim();
  return handle || undefined;
}

async function refreshTasks(sidebar: SidebarProvider): Promise<void> {
  const assigneeHandle = getConfiguredHandle();

  try {
    const data = await fetchTaskList(assigneeHandle);
    const pending = sortByOrder(data.tasks.filter((task) => task.status !== 'done'));
    const completed = sortByOrder(data.tasks.filter((task) => task.status === 'done'));
    currentTasks = [...pending, ...completed];
    sidebar.updateTasks(currentTasks);
  } catch (error) {
    const retry = 'Retry';
    const picked = await vscode.window.showErrorMessage(`ContextHUD failed to fetch tasks: ${String(error)}`, retry);
    if (picked === retry) {
      await refreshTasks(sidebar);
    }
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

function getWorkspaceFsPath(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('Open a workspace folder first.');
  }
  return folder.uri.fsPath;
}

async function getRepoRootCached(): Promise<string> {
  const workspaceFsPath = getWorkspaceFsPath();

  if (repoRootCacheByWorkspace.has(workspaceFsPath)) {
    const cached = repoRootCacheByWorkspace.get(workspaceFsPath);
    if (cached) {
      return cached;
    }
    throw new Error('Current workspace is not a Git repository.');
  }

  try {
    const repoRoot = await getRepoRoot();
    repoRootCacheByWorkspace.set(workspaceFsPath, repoRoot);
    return repoRoot;
  } catch {
    repoRootCacheByWorkspace.set(workspaceFsPath, null);
    throw new Error('Current workspace is not a Git repository.');
  }
}

function mergeLinkedFiles(existing: string[] = [], additions: string[] = []): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const entry of [...existing, ...additions]) {
    const raw = String(entry || '').trim();
    if (!raw) {
      continue;
    }
    const normalized = normalizeFilePath(raw);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(raw);
  }

  return result;
}

function scheduleLinkedFilesPatch(taskId: string, linkedFiles: string[], sidebar: SidebarProvider): void {
  const existingTimer = linkedFilesPatchTimerByTask.get(taskId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(async () => {
    try {
      await patchTask(taskId, { linkedFiles });
      await refreshTasks(sidebar);
    } catch {
      // best effort
    } finally {
      linkedFilesPatchTimerByTask.delete(taskId);
    }
  }, 400);

  linkedFilesPatchTimerByTask.set(taskId, timer);
}

async function startTask(taskId: string): Promise<Task> {
  const task = await getTaskById(taskId);
  const repoRoot = await getRepoRootCached();
  const prefix = vscode.workspace.getConfiguration('contexthud').get<string>('git.branchPrefix', 'ch');
  const branchName = buildBranchName(prefix || 'ch', task.id, task.title || task.description);

  const result = await checkoutOrCreateBranch(repoRoot, branchName);
  const updated = await patchTaskRequest(taskId, {
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

  let repoRoot: string;
  try {
    repoRoot = await getRepoRootCached();
  } catch (error) {
    vscode.window.showWarningMessage(String(error));
    return;
  }

  const remote = await getRemoteOriginUrl(repoRoot);
  const configuredBase = vscode.workspace.getConfiguration('contexthud').get<string>('git.baseBranch', 'main') || 'main';
  const baseBranch = await detectBaseBranch(repoRoot, configuredBase);
  const compareUrl = buildGitHubCompareUrl(remote, baseBranch, task.branchName);

  if (!compareUrl) {
    vscode.window.showWarningMessage('Open PR currently supports GitHub remotes only.');
    return;
  }

  await vscode.env.openExternal(vscode.Uri.parse(compareUrl));
  await patchTaskRequest(taskId, {
    prUrl: compareUrl,
    status: 'review'
  });
  vscode.window.showInformationMessage('Opened PR compare view and moved task to review.');
}

function resolveTaskFileUri(filePath: string): vscode.Uri {
  const workspaceFsPath = getWorkspaceFsPath();
  if (path.isAbsolute(filePath)) {
    return vscode.Uri.file(filePath);
  }
  return vscode.Uri.file(path.join(workspaceFsPath, filePath));
}

async function openChangedFile(_taskId: string, filePath: string): Promise<void> {
  const uri = resolveTaskFileUri(filePath);
  try {
    await vscode.workspace.fs.stat(uri);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
  } catch {
    vscode.window.showWarningMessage(`File not found: ${filePath}`);
  }
}

async function openAllChangedFiles(taskId: string): Promise<void> {
  const task = await getTaskById(taskId);
  let opened = 0;

  for (const filePath of task.linkedFiles || []) {
    const uri = resolveTaskFileUri(filePath);
    try {
      await vscode.workspace.fs.stat(uri);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
      opened += 1;
    } catch {
      vscode.window.showWarningMessage(`Skipped missing file: ${filePath}`);
    }
  }

  if (opened === 0) {
    vscode.window.showInformationMessage('No changed files were opened.');
  }
}

async function addCurrentFileToTask(taskId: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a file first to add it to the task.');
    return;
  }

  const task = await getTaskById(taskId);
  const currentFile = getWorkspaceRelativePath(editor.document.uri);
  const linkedFiles = mergeLinkedFiles(task.linkedFiles || [], [currentFile]);

  if ((task.linkedFiles || []).length === linkedFiles.length) {
    vscode.window.showInformationMessage('Current file is already linked to this task.');
    return;
  }

  await patchTask(taskId, { linkedFiles });
  vscode.window.showInformationMessage(`Added ${currentFile} to task.`);
}

async function copyFileList(taskId: string): Promise<void> {
  const task = await getTaskById(taskId);
  const list = (task.linkedFiles || []).join('\n');
  await vscode.env.clipboard.writeText(list);
  vscode.window.showInformationMessage('Copied changed file list to clipboard.');
}

async function viewCommitDiff(sha: string): Promise<void> {
  let repoRoot: string;
  try {
    repoRoot = await getRepoRootCached();
  } catch (error) {
    vscode.window.showWarningMessage(String(error));
    return;
  }

  const content = await showCommitDiff(repoRoot, sha);
  const doc = await vscode.workspace.openTextDocument({
    language: 'diff',
    content: content || '(No diff output for this commit.)'
  });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active, true);
}

async function viewTaskDiffForTask(taskId: string): Promise<void> {
  const task = await getTaskById(taskId);
  if (!task.branchName) {
    vscode.window.showWarningMessage('Task has no branch yet. Click Start Task first.');
    return;
  }

  let repoRoot: string;
  try {
    repoRoot = await getRepoRootCached();
  } catch (error) {
    vscode.window.showWarningMessage(String(error));
    return;
  }

  const baseBranch = vscode.workspace.getConfiguration('contexthud').get<string>('git.baseBranch', 'main') || 'main';
  const content = await showTaskDiff(repoRoot, baseBranch, task.branchName);
  const header = `# Task Diff\n# Base: ${baseBranch}\n# Branch: ${task.branchName}\n\n`;

  const doc = await vscode.workspace.openTextDocument({
    language: 'diff',
    content: header + (content || '(No differences found between base and task branch.)')
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

  let repoRoot: string;
  try {
    repoRoot = await getRepoRootCached();
  } catch {
    return;
  }

  try {
    const task = await getTaskById(activeTaskId);
    if (!task.branchName) {
      return;
    }

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
    const updatedTask = await addTaskCommit(activeTaskId, commit);
    lastSeenCommitByTask.set(activeTaskId, sha);

    const changedFiles = await getChangedFilesForCommit(repoRoot, sha);
    if (changedFiles.length > 0) {
      const mergedLinkedFiles = mergeLinkedFiles(updatedTask.linkedFiles || [], changedFiles);
      if (mergedLinkedFiles.length !== (updatedTask.linkedFiles || []).length) {
        scheduleLinkedFilesPatch(activeTaskId, mergedLinkedFiles, sidebar);
      }
    }

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
