import * as vscode from 'vscode';
import { Task } from './shared/types';

interface DetailMessage {
  type: 'requestTask' | 'startTask' | 'setStatus' | 'savePatch' | 'openPr' | 'openCommit';
  status?: Task['status'];
  title?: string;
  description?: string;
  branchName?: string;
  linkedFiles?: string;
  autoCloseOnMerge?: boolean;
  sha?: string;
}

interface TaskApi {
  getTaskById: (taskId: string) => Promise<Task>;
  patchTask: (taskId: string, patch: Record<string, unknown>) => Promise<Task>;
  startTask: (taskId: string) => Promise<Task>;
  openPr: (taskId: string) => Promise<void>;
  openCommit: (sha: string) => Promise<void>;
}

export class TaskDetailPanel {
  private static readonly viewType = 'contexthud.taskDetail';
  private static readonly panels = new Map<string, TaskDetailPanel>();

  static open(context: vscode.ExtensionContext, taskId: string, api: TaskApi, onTaskChanged: () => Promise<void>): void {
    const existing = TaskDetailPanel.panels.get(taskId);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      void existing.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      TaskDetailPanel.viewType,
      `Task ${taskId.slice(0, 8)}`,
      vscode.ViewColumn.Active,
      { enableScripts: true }
    );

    const instance = new TaskDetailPanel(panel, taskId, api, onTaskChanged);
    TaskDetailPanel.panels.set(taskId, instance);
    void instance.refresh();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly taskId: string,
    private readonly api: TaskApi,
    private readonly onTaskChanged: () => Promise<void>
  ) {
    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage((message: DetailMessage) => {
      void this.handleMessage(message).catch((error) => {
        void vscode.window.showErrorMessage(`ContextHUD action failed: ${String(error)}`);
      });
    });
    this.panel.onDidDispose(() => TaskDetailPanel.panels.delete(this.taskId));
  }

  private async handleMessage(message: DetailMessage): Promise<void> {
    if (message.type === 'requestTask') {
      await this.refresh();
      return;
    }

    if (message.type === 'startTask') {
      await this.api.startTask(this.taskId);
      await this.afterMutation();
      return;
    }

    if (message.type === 'setStatus' && message.status) {
      await this.api.patchTask(this.taskId, { status: message.status });
      await this.afterMutation();
      return;
    }

    if (message.type === 'savePatch') {
      const linkedFiles = String(message.linkedFiles || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);

      await this.api.patchTask(this.taskId, {
        title: message.title,
        description: message.description,
        branchName: message.branchName,
        linkedFiles,
        autoCloseOnMerge: message.autoCloseOnMerge
      });
      await this.afterMutation();
      return;
    }

    if (message.type === 'openPr') {
      await this.api.openPr(this.taskId);
      await this.afterMutation();
      return;
    }

    if (message.type === 'openCommit' && message.sha) {
      await this.api.openCommit(message.sha);
    }
  }

  private async afterMutation(): Promise<void> {
    await this.onTaskChanged();
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const task = await this.api.getTaskById(this.taskId);
    this.panel.title = task.title || `Task ${this.taskId.slice(0, 8)}`;
    this.panel.webview.postMessage({ type: 'taskData', task });
  }

  private getHtml(): string {
    const nonce = Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: "IBM Plex Sans", "Segoe UI", sans-serif; margin: 0; padding: 16px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
    .grid { display: grid; gap: 10px; max-width: 900px; }
    input, textarea { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 6px; padding: 8px; }
    textarea { min-height: 90px; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    button { border: 1px solid #2f9c90; background: #214741; color: #d6fff8; border-radius: 6px; padding: 6px 10px; cursor: pointer; }
    button:hover { background: #2a5c54; }
    .label { font-size: 12px; opacity: 0.8; }
    .block { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 10px; }
    ul { margin-top: 6px; }
    .commit-link { cursor: pointer; color: #8be6dc; text-decoration: underline; }
    .status { display: flex; align-items: center; gap: 8px; font-size: 12px; opacity: 0.95; }
    .status-badge { border-radius: 999px; padding: 3px 10px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; }
    .status-todo { background: rgba(72, 158, 255, 0.2); color: #b7ddff; border: 1px solid rgba(72, 158, 255, 0.45); }
    .status-in-progress { background: rgba(227, 191, 64, 0.2); color: #ffe8a4; border: 1px solid rgba(227, 191, 64, 0.45); }
    .status-blocked { background: rgba(219, 72, 72, 0.2); color: #ffc2c2; border: 1px solid rgba(219, 72, 72, 0.5); }
    .status-review { background: rgba(171, 113, 255, 0.2); color: #e3ccff; border: 1px solid rgba(171, 113, 255, 0.5); }
    .status-done { background: rgba(79, 194, 114, 0.22); color: #bff7d0; border: 1px solid rgba(79, 194, 114, 0.45); }
    button.active { border-color: #f5f7f9; box-shadow: 0 0 0 2px rgba(245, 247, 249, 0.35) inset; }
    .check-row { display: flex; align-items: center; gap: 8px; }
    .check-row input { width: auto; }
  </style>
</head>
<body>
  <div class="grid">
    <div class="status">Current Status: <span id="currentStatus" class="status-badge status-todo">TODO</span></div>
    <div class="row">
      <button id="start">Start Task</button>
      <button data-status="todo">Todo</button>
      <button data-status="in_progress">In Progress</button>
      <button data-status="blocked">Blocked</button>
      <button data-status="review">Review</button>
      <button data-status="done">Done</button>
      <button id="openPr">Open PR</button>
    </div>

    <div>
      <div class="label">Title</div>
      <input id="title" />
    </div>

    <div>
      <div class="label">Description</div>
      <textarea id="description"></textarea>
    </div>

    <div>
      <div class="label">Linked Files (comma separated)</div>
      <input id="linkedFiles" />
    </div>

    <div>
      <div class="label">Branch Name</div>
      <input id="branchName" />
    </div>

    <label class="check-row">
      <input type="checkbox" id="autoCloseOnMerge" />
      <span>Auto-close when PR merges</span>
    </label>

    <div><button id="save">Save Changes</button></div>

    <div class="block">
      <div class="label">Commits</div>
      <ul id="commits"></ul>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const title = document.getElementById('title');
    const description = document.getElementById('description');
    const linkedFiles = document.getElementById('linkedFiles');
    const branchName = document.getElementById('branchName');
    const autoCloseOnMerge = document.getElementById('autoCloseOnMerge');

    document.getElementById('start').addEventListener('click', () => vscode.postMessage({ type: 'startTask' }));
    document.getElementById('openPr').addEventListener('click', () => vscode.postMessage({ type: 'openPr' }));
    document.getElementById('save').addEventListener('click', () => {
      vscode.postMessage({
        type: 'savePatch',
        title: title.value,
        description: description.value,
        linkedFiles: linkedFiles.value,
        branchName: branchName.value,
        autoCloseOnMerge: autoCloseOnMerge.checked
      });
    });

    Array.from(document.querySelectorAll('button[data-status]')).forEach((btn) => {
      btn.addEventListener('click', () => vscode.postMessage({ type: 'setStatus', status: btn.getAttribute('data-status') }));
    });

    function setActiveStatus(status) {
      const normalized = String(status || 'todo');
      const badge = document.getElementById('currentStatus');
      badge.textContent = normalized.replace('_', ' ').toUpperCase();

      const classMap = {
        todo: 'status-todo',
        in_progress: 'status-in-progress',
        blocked: 'status-blocked',
        review: 'status-review',
        done: 'status-done'
      };

      badge.className = 'status-badge ' + (classMap[normalized] || 'status-todo');

      Array.from(document.querySelectorAll('button[data-status]')).forEach((btn) => {
        if (btn.getAttribute('data-status') === normalized) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    function renderCommits(commits) {
      const node = document.getElementById('commits');
      if (!Array.isArray(commits) || commits.length === 0) {
        node.innerHTML = '<li>No commits linked yet.</li>';
        return;
      }

      node.innerHTML = commits.map((c) => {
        const shortSha = (c.sha || '').slice(0, 7);
        const date = c.date ? new Date(c.date).toLocaleString() : '';
        return '<li><span class="commit-link" data-sha="' + c.sha + '">' + shortSha + '</span> · ' + (c.message || '') + ' · ' + date + '</li>';
      }).join('');

      node.querySelectorAll('.commit-link').forEach((el) => {
        el.addEventListener('click', () => {
          vscode.postMessage({ type: 'openCommit', sha: el.getAttribute('data-sha') });
        });
      });
    }

    window.addEventListener('message', (event) => {
      const task = event.data?.task;
      if (!task) return;

      title.value = task.title || '';
      description.value = task.description || '';
      linkedFiles.value = Array.isArray(task.linkedFiles) ? task.linkedFiles.join(', ') : '';
      branchName.value = task.branchName || '';
      autoCloseOnMerge.checked = Boolean(task.autoCloseOnMerge);
      setActiveStatus(task.status);
      renderCommits(task.commits || []);
    });

    vscode.postMessage({ type: 'requestTask' });
  </script>
</body>
</html>`;
  }
}
