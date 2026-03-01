import * as vscode from 'vscode';
import { RelayUser, Task } from './shared/types';

type SidebarScope = 'my' | 'all';

interface SidebarMessage {
  type: 'openTask' | 'signIn' | 'setScope';
  taskId?: string;
  scope?: SidebarScope;
}

interface SidebarViewState {
  tasks: Task[];
  user?: RelayUser;
  scope: SidebarScope;
  loginInProgress: boolean;
  authRequired: boolean;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'contexthud.sidebar';

  private view?: vscode.WebviewView;
  private onOpenTask?: (taskId: string) => void;
  private onSignIn?: () => void;
  private onSetScope?: (scope: SidebarScope) => void;
  private state: SidebarViewState = {
    tasks: [],
    scope: 'all',
    loginInProgress: false,
    authRequired: false
  };

  setOnOpenTask(handler: (taskId: string) => void): void {
    this.onOpenTask = handler;
  }

  setOnSignIn(handler: () => void): void {
    this.onSignIn = handler;
  }

  setOnSetScope(handler: (scope: SidebarScope) => void): void {
    this.onSetScope = handler;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.getHtml();

    view.webview.onDidReceiveMessage((message: SidebarMessage) => {
      if (message.type === 'openTask' && message.taskId && this.onOpenTask) {
        this.onOpenTask(message.taskId);
        return;
      }

      if (message.type === 'signIn' && this.onSignIn) {
        this.onSignIn();
        return;
      }

      if (message.type === 'setScope' && message.scope && this.onSetScope) {
        this.onSetScope(message.scope);
      }
    });

    this.postState();
  }

  updateTasks(tasks: Task[]): void {
    this.state.tasks = tasks;
    this.postState();
  }

  updateAuthState(partial: Partial<Omit<SidebarViewState, 'tasks'>>): void {
    this.state = {
      ...this.state,
      ...partial
    };
    this.postState();
  }

  private postState(): void {
    this.view?.webview.postMessage({
      type: 'state',
      state: this.state
    });
  }

  private getHtml(): string {
    const nonce = Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; script-src 'nonce-${nonce}';" />
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
    .header { border: 1px solid var(--border); border-radius: 8px; background: var(--panel); padding: 8px; margin-bottom: 8px; }
    .user-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .user-meta { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .avatar { width: 20px; height: 20px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.2); object-fit: cover; }
    .login { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub { color: var(--muted); font-size: 10px; margin-top: 4px; }
    .btn { border: 1px solid #2f9c90; background: #214741; color: #d6fff8; border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer; }
    .btn:disabled { opacity: 0.6; cursor: default; }
    .filter { display: flex; gap: 6px; margin-top: 8px; }
    .filter button { flex: 1; border: 1px solid var(--border); background: #1f2937; color: var(--ink); border-radius: 6px; font-size: 11px; padding: 5px 6px; cursor: pointer; }
    .filter button.active { border-color: var(--accent); color: #e6fff8; }
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
    .pill-review { background: rgba(171, 113, 255, 0.2); color: #e3ccff; border: 1px solid rgba(171, 113, 255, 0.5); }
    .pill-done { background: rgba(79, 194, 114, 0.22); color: #bff7d0; border: 1px solid rgba(79, 194, 114, 0.45); }
    .meta { color: var(--muted); font-size: 10px; }
    .empty { color: var(--muted); font-size: 12px; padding: 12px; border: 1px dashed var(--border); border-radius: 8px; }
  </style>
</head>
<body>
  <section class="header">
    <div id="auth"></div>
    <div class="filter">
      <button id="scopeMy">My Tasks</button>
      <button id="scopeAll">All Tasks</button>
    </div>
  </section>
  <div id="list"><div class="empty">No tasks assigned.</div></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const list = document.getElementById('list');
    const authNode = document.getElementById('auth');
    const scopeMy = document.getElementById('scopeMy');
    const scopeAll = document.getElementById('scopeAll');

    function escapeHtml(v) {
      return String(v || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
    }

    scopeMy.addEventListener('click', () => vscode.postMessage({ type: 'setScope', scope: 'my' }));
    scopeAll.addEventListener('click', () => vscode.postMessage({ type: 'setScope', scope: 'all' }));

    function renderAuth(state) {
      const user = state.user;
      const isWaiting = !!state.loginInProgress;
      const needsAuth = !!state.authRequired;

      if (!user) {
        authNode.innerHTML = [
          '<div class="user-row">',
          '  <div>',
          '    <div class="login">Not signed in</div>',
          needsAuth ? '    <div class="sub">Sign in to enable My Tasks by GitHub user.</div>' : '    <div class="sub">Viewing tasks without authentication.</div>',
          '  </div>',
          '  <button id="signin" class="btn" ' + (isWaiting ? 'disabled' : '') + '>' + (isWaiting ? 'Waiting…' : 'Sign in with GitHub') + '</button>',
          '</div>'
        ].join('');

        const signInBtn = document.getElementById('signin');
        if (signInBtn) {
          signInBtn.addEventListener('click', () => vscode.postMessage({ type: 'signIn' }));
        }
      } else {
        const avatar = user.avatarUrl ? '<img class="avatar" src="' + escapeHtml(user.avatarUrl) + '" />' : '<div class="avatar"></div>';
        authNode.innerHTML = [
          '<div class="user-row">',
          '  <div class="user-meta">',
          '    ' + avatar,
          '    <div>',
          '      <div class="login">' + escapeHtml(user.login) + '</div>',
          '      <div class="sub">' + escapeHtml(user.name || 'Signed in') + '</div>',
          '    </div>',
          '  </div>',
          '</div>'
        ].join('');
      }

      scopeMy.classList.toggle('active', state.scope === 'my');
      scopeAll.classList.toggle('active', state.scope === 'all');
      scopeMy.disabled = !user;
      if (!user && state.scope === 'my') {
        scopeMy.classList.remove('active');
        scopeAll.classList.add('active');
      }
    }

    function renderTasks(tasks) {
      if (!Array.isArray(tasks) || tasks.length === 0) {
        list.innerHTML = '<div class="empty">No tasks assigned.</div>';
        return;
      }

      list.innerHTML = tasks.map(task => {
        const title = escapeHtml(task.title || task.description || 'Untitled task');
        const statusRaw = String(task.status || 'todo');
        const status = escapeHtml(statusRaw.replace('_', ' '));
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
      if (event.data?.type !== 'state' || !event.data?.state) {
        return;
      }

      const state = event.data.state;
      renderAuth(state);
      renderTasks(state.tasks || []);
    });
  </script>
</body>
</html>`;
  }
}
