import * as vscode from 'vscode';
import { Task } from './shared/types';

interface DetailMessage {
  type: 'requestTask' | 'startTask' | 'setStatus' | 'askAi' | 'savePatch' | 'openPr' | 'openCommit';
  status?: Task['status'];
  title?: string;
  description?: string;
  branchName?: string;
  linkedFiles?: string;
  sha?: string;
}

interface TaskApi {
  getTaskById: (taskId: string) => Promise<Task>;
  patchTask: (taskId: string, patch: Record<string, unknown>) => Promise<Task>;
  summarizeTask: (taskId: string) => Promise<Task>;
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
    this.panel.webview.onDidReceiveMessage((message: DetailMessage) => void this.handleMessage(message));
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

    if (message.type === 'askAi') {
      await this.api.summarizeTask(this.taskId);
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
        linkedFiles
      });
      await this.afterMutation();
      return;
    }

    if (message.type === 'openPr') {
      await this.api.openPr(this.taskId);
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
  </style>
</head>
<body>
  <div class="grid">
    <div class="row">
      <button id="start">Start Task</button>
      <button data-status="todo">Todo</button>
      <button data-status="in_progress">In Progress</button>
      <button data-status="blocked">Blocked</button>
      <button data-status="done">Done</button>
      <button id="openPr">Open PR</button>
      <button id="askAi">Ask AI</button>
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

    <div><button id="save">Save Changes</button></div>

    <div class="block">
      <div class="label">Commits</div>
      <ul id="commits"></ul>
    </div>

    <div class="block">
      <div class="label">AI Summary</div>
      <p id="aiSummary">No summary yet.</p>
      <div class="label">Acceptance Criteria</div>
      <ul id="aiCriteria"></ul>
      <div class="label">Open Questions</div>
      <ul id="aiQuestions"></ul>
      <div class="label">Tags</div>
      <p id="aiTags">-</p>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const title = document.getElementById('title');
    const description = document.getElementById('description');
    const linkedFiles = document.getElementById('linkedFiles');
    const branchName = document.getElementById('branchName');

    document.getElementById('start').addEventListener('click', () => vscode.postMessage({ type: 'startTask' }));
    document.getElementById('openPr').addEventListener('click', () => vscode.postMessage({ type: 'openPr' }));
    document.getElementById('askAi').addEventListener('click', () => vscode.postMessage({ type: 'askAi' }));
    document.getElementById('save').addEventListener('click', () => {
      vscode.postMessage({
        type: 'savePatch',
        title: title.value,
        description: description.value,
        linkedFiles: linkedFiles.value,
        branchName: branchName.value
      });
    });

    Array.from(document.querySelectorAll('button[data-status]')).forEach((btn) => {
      btn.addEventListener('click', () => vscode.postMessage({ type: 'setStatus', status: btn.getAttribute('data-status') }));
    });

    function setList(id, values) {
      const node = document.getElementById(id);
      if (!Array.isArray(values) || values.length === 0) {
        node.innerHTML = '<li>None</li>';
        return;
      }
      node.innerHTML = values.map((v) => '<li>' + v + '</li>').join('');
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
      document.getElementById('aiSummary').textContent = task.ai_summary || 'No summary yet.';
      setList('aiCriteria', task.ai_acceptance_criteria || []);
      setList('aiQuestions', task.ai_open_questions || []);
      document.getElementById('aiTags').textContent = (task.ai_tags || []).join(', ') || '-';
      renderCommits(task.commits || []);
    });

    vscode.postMessage({ type: 'requestTask' });
  </script>
</body>
</html>`;
  }
}
