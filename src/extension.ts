import * as path from 'path';
import * as vscode from 'vscode';
import { SidebarProvider } from './SidebarProvider';
import { RelayUser, Task } from './shared/types';
import { getWorkspaceRelativePath, normalizeFilePath, prioritizeByFile, sortByOrder } from './shared/taskUtils';
import { TaskDetailPanel } from './TaskDetailPanel';
import {
  addTaskCommit,
  clearApiContext,
  fetchMe,
  fetchTaskList,
  getTaskById,
  getApiContext,
  patchTask,
  pollVscodeToken,
  setApiContext,
  setAuthToken,
  startVscodeLogin
} from './api/client';
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
import { readRepoConfig, writeRepoConfig } from './shared/repoConfig';
import { getRelayNumberSetting, getRelayStringSetting } from './shared/settings';

let currentTasks: Task[] = [];
let refreshTimeoutHandle: NodeJS.Timeout | undefined;
let commitPollHandle: NodeJS.Timeout | undefined;
const lastSeenCommitByTask = new Map<string, string>();
const linkedFilesPatchTimerByTask = new Map<string, NodeJS.Timeout>();
const repoRootCacheByWorkspace = new Map<string, string | null>();

let refreshBackoffMs = 5000;
let loginInProgress = false;
let authRequired = false;
let authUser: RelayUser | undefined;
let taskScope: 'my' | 'all' = 'all';
let configReady = false;
let lastSyncAt: string | undefined;

const SESSION_TOKEN_KEY = 'relay.sessionToken.v1';
const LEGACY_SESSION_TOKEN_KEY = 'contexthud.sessionToken.v1';
const diagnosticsOutput = vscode.window.createOutputChannel('Relay Diagnostics');

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const sidebar = new SidebarProvider();
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar));
  context.subscriptions.push(diagnosticsOutput);

  maybeShowSecondarySidebarOnboarding(context);

  const storedToken = (await context.secrets.get(SESSION_TOKEN_KEY)) || (await context.secrets.get(LEGACY_SESSION_TOKEN_KEY));
  if (storedToken) {
    setAuthToken(storedToken);
    await context.secrets.store(SESSION_TOKEN_KEY, storedToken);
  }

  await loadRepoConfig(sidebar, { interactive: false });
  await refreshAuthState(context, sidebar);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      repoRootCacheByWorkspace.clear();
      void loadRepoConfig(sidebar, { interactive: false });
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
        await refreshTasks(sidebar, { interactive: false });
      }
    );
  });

  sidebar.setOnSignIn(() => {
    void startLoginFlow(context, sidebar);
  });

  sidebar.setOnSetScope((scope) => {
    void setTaskScope(scope, sidebar);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('contexthud.refresh', async () => {
      await refreshTasks(sidebar, { interactive: true });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contexthud.initializeProjectConfig', async () => {
      try {
        const config = await writeRepoConfig();
        setApiContext({ apiBaseUrl: config.apiBaseUrl, projectId: config.projectId });
        configReady = true;
        refreshBackoffMs = 5000;
        void vscode.window.showInformationMessage(`Relay initialized for project ${config.projectId}.`);
        await refreshTasks(sidebar, { interactive: true });
      } catch (error) {
        void vscode.window.showErrorMessage(`Relay initialization failed: ${String(error)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contexthud.diagnostics', async () => {
      await runDiagnostics();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('relay.refresh', async () => {
      await vscode.commands.executeCommand('contexthud.refresh');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('relay.initializeProjectConfig', async () => {
      await vscode.commands.executeCommand('contexthud.initializeProjectConfig');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('relay.diagnostics', async () => {
      await vscode.commands.executeCommand('contexthud.diagnostics');
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

  await refreshTasks(sidebar, { interactive: false });
  scheduleNextRefresh(sidebar, 5000);

  startCommitLinkPolling(context, sidebar);

  context.subscriptions.push({
    dispose: () => {
      if (refreshTimeoutHandle) {
        clearTimeout(refreshTimeoutHandle);
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
  if (refreshTimeoutHandle) {
    clearTimeout(refreshTimeoutHandle);
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
  const key = 'relay.onboarding.secondarySidebar.v1';
  const seen = context.globalState.get<boolean>(key, false) || context.globalState.get<boolean>('contexthud.onboarding.secondarySidebar.v1', false);
  if (seen) {
    return;
  }

  void context.globalState.update(key, true);
  void vscode.window.showInformationMessage(
    'Relay tip: move Relay to the right side. Right-click the Relay view title -> Move View -> Secondary Side Bar.'
  );
}

async function loadRepoConfig(sidebar: SidebarProvider, options: { interactive: boolean }): Promise<void> {
  const config = await readRepoConfig();
  if (!config) {
    configReady = false;
    clearApiContext();
    currentTasks = [];
    sidebar.updateTasks([]);
    if (options.interactive) {
      const action = 'Initialize Relay for this repo';
      const selected = await vscode.window.showWarningMessage(
        'Relay config missing. Create .relay/config.json (or legacy .contexthud/config.json) to continue.',
        action
      );
      if (selected === action) {
        await vscode.commands.executeCommand('contexthud.initializeProjectConfig');
      }
    }
    return;
  }

  configReady = true;
  setApiContext({ apiBaseUrl: config.apiBaseUrl, projectId: config.projectId });
}

function updateSidebarAuthState(sidebar: SidebarProvider): void {
  sidebar.updateAuthState({
    user: authUser,
    scope: taskScope,
    authRequired,
    loginInProgress
  });
}

async function refreshAuthState(context: vscode.ExtensionContext, sidebar: SidebarProvider): Promise<void> {
  try {
    if (!configReady) {
      authUser = undefined;
      authRequired = true;
      taskScope = 'all';
      updateSidebarAuthState(sidebar);
      return;
    }

    const me = await fetchMe();
    authUser = me;
    authRequired = false;
    if (taskScope !== 'my') {
      taskScope = 'my';
    }
  } catch {
    authUser = undefined;
    authRequired = true;
    taskScope = 'all';
    setAuthToken(undefined);
    await context.secrets.delete(SESSION_TOKEN_KEY);
    await context.secrets.delete(LEGACY_SESSION_TOKEN_KEY);
  }

  updateSidebarAuthState(sidebar);
}

async function startLoginFlow(context: vscode.ExtensionContext, sidebar: SidebarProvider): Promise<void> {
  if (loginInProgress) {
    return;
  }

  if (!configReady) {
    await loadRepoConfig(sidebar, { interactive: true });
    if (!configReady) {
      return;
    }
  }

  loginInProgress = true;
  updateSidebarAuthState(sidebar);

  try {
    const started = await startVscodeLogin();
    await vscode.env.openExternal(vscode.Uri.parse(started.loginUrl));

    const deadline = Date.now() + 30_000;
    let me: RelayUser | undefined;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500));

      try {
        const polled = await pollVscodeToken(started.loginId);
        if (!polled?.token) {
          continue;
        }

        setAuthToken(polled.token);
        await context.secrets.store(SESSION_TOKEN_KEY, polled.token);
        me = await fetchMe();
        break;
      } catch {
        // continue polling
      }
    }

    if (!me) {
      void vscode.window.showWarningMessage('GitHub sign-in timed out. Try again.');
      return;
    }

    authUser = me;
    authRequired = false;
    taskScope = 'my';
    refreshBackoffMs = 5000;
    updateSidebarAuthState(sidebar);
    await refreshTasks(sidebar, { interactive: true });
    void vscode.window.showInformationMessage(`Signed in as ${me.login}.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Sign-in failed: ${String(error)}`);
  } finally {
    loginInProgress = false;
    updateSidebarAuthState(sidebar);
  }
}

async function setTaskScope(scope: 'my' | 'all', sidebar: SidebarProvider): Promise<void> {
  if (scope === 'my' && !authUser) {
    void vscode.window.showWarningMessage('Sign in with GitHub first to use My Tasks.');
    return;
  }

  taskScope = scope;
  updateSidebarAuthState(sidebar);
  await refreshTasks(sidebar, { interactive: false });
}

interface RefreshOptions {
  interactive: boolean;
}

function getTaskFetchParams(): { assigned: 'me' | 'all' } {
  if (authUser) {
    return { assigned: taskScope === 'my' ? 'me' : 'all' };
  }

  return { assigned: 'all' };
}

async function refreshTasks(sidebar: SidebarProvider, options: RefreshOptions): Promise<void> {
  if (!configReady) {
    await loadRepoConfig(sidebar, { interactive: options.interactive });
    if (!configReady) {
      return;
    }
  }

  try {
    const data = await fetchTaskList(getTaskFetchParams());
    const pending = sortByOrder(data.tasks.filter((task) => task.status !== 'done'));
    const completed = sortByOrder(data.tasks.filter((task) => task.status === 'done'));
    currentTasks = [...pending, ...completed];
    sidebar.updateTasks(currentTasks);
    refreshBackoffMs = 5000;
    lastSyncAt = new Date().toISOString();
  } catch (error) {
    const msg = String(error || 'Unknown error');

    if (msg.includes('401')) {
      authUser = undefined;
      authRequired = true;
      taskScope = 'all';
      updateSidebarAuthState(sidebar);
      if (options.interactive) {
        void vscode.window.showWarningMessage('You are signed out. Use Sign in with GitHub in Relay.');
      }
    } else if (msg.includes('403')) {
      if (options.interactive) {
        void vscode.window.showWarningMessage('You are not a member of this project.');
      }
    } else if (options.interactive) {
      const retry = 'Retry';
      const picked = await vscode.window.showErrorMessage(`Relay failed to fetch tasks: ${msg}`, retry);
      if (picked === retry) {
        await refreshTasks(sidebar, { interactive: true });
      }
    }

    refreshBackoffMs = Math.min(refreshBackoffMs * 2, 30000);
  }
}

function scheduleNextRefresh(sidebar: SidebarProvider, delayMs: number): void {
  if (refreshTimeoutHandle) {
    clearTimeout(refreshTimeoutHandle);
  }

  refreshTimeoutHandle = setTimeout(async () => {
    await refreshTasks(sidebar, { interactive: false });
    scheduleNextRefresh(sidebar, refreshBackoffMs);
  }, delayMs);
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
      await refreshTasks(sidebar, { interactive: false });
    } catch {
      // best effort
    } finally {
      linkedFilesPatchTimerByTask.delete(taskId);
    }
  }, 400);

  linkedFilesPatchTimerByTask.set(taskId, timer);
}

async function patchTaskRequest(taskId: string, patch: Record<string, unknown>): Promise<Task> {
  const updated = await patchTask(taskId, patch);
  currentTasks = currentTasks.map((task) => (task.id === updated.id ? updated : task));
  return updated;
}

async function startTask(taskId: string): Promise<Task> {
  const task = await getTaskById(taskId);
  const repoRoot = await getRepoRootCached();
  const prefix = getRelayStringSetting('git.branchPrefix', 'ch');
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
  const configuredBase = (await readRepoConfig())?.baseBranch || getRelayStringSetting('git.baseBranch', 'main') || 'main';
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

  const baseBranch = (await readRepoConfig())?.baseBranch || getRelayStringSetting('git.baseBranch', 'main') || 'main';
  const content = await showTaskDiff(repoRoot, baseBranch, task.branchName);
  const header = `# Task Diff\n# Base: ${baseBranch}\n# Branch: ${task.branchName}\n\n`;

  const doc = await vscode.workspace.openTextDocument({
    language: 'diff',
    content: header + (content || '(No differences found between base and task branch.)')
  });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active, true);
}

function startCommitLinkPolling(context: vscode.ExtensionContext, sidebar: SidebarProvider): void {
  const intervalSec = Math.max(5, Number(getRelayNumberSetting('git.commitPollIntervalSec', 15)));

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

    await refreshTasks(sidebar, { interactive: false });
  } catch {
    // best-effort polling; keep silent to avoid noisy UX
  }
}

async function runDiagnostics(): Promise<void> {
  diagnosticsOutput.clear();
  diagnosticsOutput.appendLine('Relay Diagnostics');
  diagnosticsOutput.appendLine(`time: ${new Date().toISOString()}`);

  const config = await readRepoConfig();
  diagnosticsOutput.appendLine(`config.loaded: ${Boolean(config)}`);
  diagnosticsOutput.appendLine(`config.apiBaseUrl: ${config?.apiBaseUrl || '<missing>'}`);
  diagnosticsOutput.appendLine(`config.projectId: ${config?.projectId || '<missing>'}`);
  diagnosticsOutput.appendLine(`config.baseBranch: ${config?.baseBranch || '<missing>'}`);
  diagnosticsOutput.appendLine(`user.login: ${authUser?.login || '<not signed in>'}`);
  diagnosticsOutput.appendLine(`task.scope: ${taskScope}`);
  diagnosticsOutput.appendLine(`last.syncAt: ${lastSyncAt || '<never>'}`);

  try {
    const repoRoot = await getRepoRootCached();
    diagnosticsOutput.appendLine(`repo.root: ${repoRoot}`);
    const branch = await getCurrentBranch(repoRoot);
    diagnosticsOutput.appendLine(`repo.branch: ${branch}`);
  } catch (error) {
    diagnosticsOutput.appendLine(`repo.error: ${String(error)}`);
  }

  try {
    const context = getApiContext();
    if (context) {
      const response = await fetch(`${context.apiBaseUrl}/health`);
      diagnosticsOutput.appendLine(`backend.health.status: ${response.status}`);
      diagnosticsOutput.appendLine(`backend.health.body: ${await response.text()}`);
    } else {
      diagnosticsOutput.appendLine('backend.health: skipped (missing API context)');
    }
  } catch (error) {
    diagnosticsOutput.appendLine(`backend.health.error: ${String(error)}`);
  }

  diagnosticsOutput.show(true);
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
