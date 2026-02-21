import * as vscode from 'vscode';
import { Task } from './shared/types';

interface DoneMessage {
  type: 'taskDone';
  taskId: string;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'contexthud.sidebar';

  private view?: vscode.WebviewView;
  private onDoneTask?: (taskId: string) => void;

  constructor(private readonly extensionUri: vscode.Uri) {}

  setOnDoneTask(handler: (taskId: string) => void): void {
    this.onDoneTask = handler;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;

    view.webview.options = {
      enableScripts: true
    };

    view.webview.html = this.getHtml(view.webview);

    view.webview.onDidReceiveMessage((message: DoneMessage) => {
      if (message.type === 'taskDone' && this.onDoneTask) {
        this.onDoneTask(message.taskId);
      }
    });
  }

  updateTasks(tasks: Task[]): void {
    this.view?.webview.postMessage({
      type: 'tasksUpdate',
      tasks
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ContextHUD</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background, #1e1e1e);
      --panel: var(--vscode-editorWidget-background, #252526);
      --ink: var(--vscode-sideBar-foreground, #cccccc);
      --muted: var(--vscode-descriptionForeground, #9da5b4);
      --accent: #34d5c3;
      --accent-soft: rgba(52, 213, 195, 0.2);
      --border: var(--vscode-panel-border, #3a3a3a);
      --path-bg: rgba(255, 255, 255, 0.04);
      --path-ink: #c4d1de;
    }
    body {
      margin: 0;
      padding: 12px;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      background: radial-gradient(circle at top right, #2b2f3a 0%, var(--bg) 60%);
      color: var(--ink);
    }
    #list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .item {
      border: 1px solid var(--border);
      border-left: 4px solid var(--accent);
      border-radius: 8px;
      background: var(--panel);
      padding: 10px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }
    .meta {
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 6px;
    }
    .title {
      margin: 0;
      font-size: 13px;
      line-height: 1.4;
    }
    .path {
      margin-top: 8px;
      font-size: 11px;
      color: var(--path-ink);
      word-break: break-all;
      background: var(--path-bg);
      border-radius: 4px;
      padding: 4px;
    }
    .actions {
      margin-top: 8px;
      display: flex;
      justify-content: flex-end;
    }
    .done {
      border: 1px solid rgba(52, 213, 195, 0.35);
      border-radius: 6px;
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 600;
      font-size: 11px;
      padding: 4px 8px;
      cursor: pointer;
    }
    .done:hover {
      background: rgba(52, 213, 195, 0.32);
    }
    .empty {
      padding: 16px;
      border: 1px dashed var(--border);
      border-radius: 8px;
      color: var(--muted);
      text-align: center;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div id="list"><div class="empty">No assigned tasks.</div></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const list = document.getElementById('list');

    function render(tasks) {
      if (!Array.isArray(tasks) || tasks.length === 0) {
        list.innerHTML = '<div class="empty">No assigned tasks.</div>';
        return;
      }

      list.innerHTML = tasks
        .map(task => {
          const safeDesc = escapeHtml(task.description || '');
          const safePath = escapeHtml(task.filePath || '');
          const index = Number(task.orderIndex || 0);

          return [
            '<section class="item">',
            '  <div class="meta">#' + index + ' • ' + new Date(task.timestamp).toLocaleString() + '</div>',
            '  <p class="title">' + safeDesc + '</p>',
            '  <div class="path">' + safePath + '</div>',
            '  <div class="actions">',
            '    <button class="done" data-id="' + task.id + '">Done</button>',
            '  </div>',
            '</section>'
          ].join('');
        })
        .join('');

      list.querySelectorAll('.done').forEach(button => {
        button.addEventListener('click', () => {
          vscode.postMessage({
            type: 'taskDone',
            taskId: button.getAttribute('data-id')
          });
        });
      });
    }

    function escapeHtml(value) {
      return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    window.addEventListener('message', event => {
      if (event.data?.type === 'tasksUpdate') {
        render(event.data.tasks);
      }
    });
  </script>
</body>
</html>`;
  }

  private getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 16; i += 1) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
