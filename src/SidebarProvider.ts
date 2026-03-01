import * as vscode from 'vscode';
import { Task } from './shared/types';

interface SidebarMessage {
  type: 'openTask';
  taskId: string;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'contexthud.sidebar';

  private view?: vscode.WebviewView;
  private onOpenTask?: (taskId: string) => void;

  setOnOpenTask(handler: (taskId: string) => void): void {
    this.onOpenTask = handler;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.getHtml();

    view.webview.onDidReceiveMessage((message: SidebarMessage) => {
      if (message.type === 'openTask' && this.onOpenTask) {
        this.onOpenTask(message.taskId);
      }
    });
  }

  updateTasks(tasks: Task[]): void {
    this.view?.webview.postMessage({ type: 'tasksUpdate', tasks });
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
    :root {
      --bg: var(--vscode-sideBar-background, #1e1e1e);
      --panel: var(--vscode-editorWidget-background, #252526);
      --ink: var(--vscode-sideBar-foreground, #cccccc);
      --muted: var(--vscode-descriptionForeground, #9da5b4);
      --accent: #34d5c3;
      --border: var(--vscode-panel-border, #3a3a3a);
    }
    body {
      margin: 0;
      padding: 10px;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
    }
    #list { display: flex; flex-direction: column; gap: 8px; }
    .item {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      padding: 8px;
      cursor: pointer;
    }
    .item:hover { border-color: var(--accent); }
    .title { font-size: 12px; font-weight: 600; margin: 0; }
    .row { margin-top: 6px; display: flex; justify-content: space-between; align-items: center; gap: 6px; }
    .pill {
      border-radius: 999px;
      font-size: 10px;
      padding: 3px 8px;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.03em;
    }
    .pill-todo { background: rgba(72, 158, 255, 0.2); color: #b7ddff; border: 1px solid rgba(72, 158, 255, 0.45); }
    .pill-in-progress { background: rgba(227, 191, 64, 0.2); color: #ffe8a4; border: 1px solid rgba(227, 191, 64, 0.45); }
    .pill-blocked { background: rgba(219, 72, 72, 0.2); color: #ffc2c2; border: 1px solid rgba(219, 72, 72, 0.5); }
    .pill-done { background: rgba(79, 194, 114, 0.22); color: #bff7d0; border: 1px solid rgba(79, 194, 114, 0.45); }
    .meta { color: var(--muted); font-size: 10px; }
    .empty { color: var(--muted); font-size: 12px; padding: 12px; border: 1px dashed var(--border); border-radius: 8px; }
  </style>
</head>
<body>
  <div id="list"><div class="empty">No tasks assigned.</div></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const list = document.getElementById('list');

    function escapeHtml(v) {
      return String(v || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
    }

    function render(tasks) {
      if (!Array.isArray(tasks) || tasks.length === 0) {
        list.innerHTML = '<div class="empty">No tasks assigned.</div>';
        return;
      }

      list.innerHTML = tasks.map(task => {
        const title = escapeHtml(task.title || task.description || 'Untitled task');
        const statusRaw = String(task.status || 'todo');
        const status = escapeHtml(statusRaw);
        const statusClass = 'pill-' + statusRaw.replace('_', '-');
        const ts = new Date(task.timestamp).toLocaleString();
        return [
          '<section class="item" data-id="' + task.id + '">',
          '  <p class="title">' + title + '</p>',
          '  <div class="row">',
          '    <span class="pill ' + statusClass + '">' + status + '</span>',
          '    <span class="meta">' + ts + ' · Slack</span>',
          '  </div>',
          '</section>'
        ].join('');
      }).join('');

      list.querySelectorAll('.item').forEach(el => {
        el.addEventListener('click', () => {
          vscode.postMessage({ type: 'openTask', taskId: el.getAttribute('data-id') });
        });
      });
    }

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'tasksUpdate') {
        render(event.data.tasks);
      }
    });
  </script>
</body>
</html>`;
  }
}
