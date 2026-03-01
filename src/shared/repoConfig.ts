import * as path from 'path';
import * as vscode from 'vscode';

export interface RepoConfig {
  apiBaseUrl: string;
  projectId: string;
  baseBranch: string;
}

const CONFIG_REL_PATH = path.join('.contexthud', 'config.json');

function normalizeApiBaseUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return 'http://localhost:8787';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/$/, '');
  }

  return `http://${trimmed}`.replace(/\/$/, '');
}

export function getConfigUri(): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }

  return vscode.Uri.joinPath(folder.uri, CONFIG_REL_PATH);
}

export async function readRepoConfig(): Promise<RepoConfig | undefined> {
  const uri = getConfigUri();
  if (!uri) {
    return undefined;
  }

  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as Partial<RepoConfig>;
    if (!parsed.projectId) {
      return undefined;
    }

    return {
      apiBaseUrl: normalizeApiBaseUrl(parsed.apiBaseUrl || 'http://localhost:8787'),
      projectId: String(parsed.projectId),
      baseBranch: String(parsed.baseBranch || 'main')
    };
  } catch {
    return undefined;
  }
}

export async function writeRepoConfig(partial?: Partial<RepoConfig>): Promise<RepoConfig> {
  const uri = getConfigUri();
  if (!uri) {
    throw new Error('Open a workspace folder first.');
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('Open a workspace folder first.');
  }

  const defaults: RepoConfig = {
    apiBaseUrl: normalizeApiBaseUrl(vscode.workspace.getConfiguration('contexthud').get<string>('apiBaseUrl', 'http://localhost:8787')),
    projectId: partial?.projectId || '',
    baseBranch: partial?.baseBranch || 'main'
  };

  if (!defaults.projectId) {
    const enteredProjectId = await vscode.window.showInputBox({
      title: 'Initialize ContextHUD',
      prompt: 'Enter projectId from the hosted backend',
      placeHolder: 'project UUID'
    });

    if (!enteredProjectId) {
      throw new Error('Project initialization cancelled.');
    }

    defaults.projectId = enteredProjectId.trim();
  }

  if (!partial?.apiBaseUrl) {
    const enteredApiBaseUrl = await vscode.window.showInputBox({
      title: 'Initialize ContextHUD',
      prompt: 'Enter hosted API base URL',
      value: defaults.apiBaseUrl,
      placeHolder: 'https://api.relay.dev'
    });

    if (!enteredApiBaseUrl) {
      throw new Error('Project initialization cancelled.');
    }

    defaults.apiBaseUrl = normalizeApiBaseUrl(enteredApiBaseUrl);
  } else {
    defaults.apiBaseUrl = normalizeApiBaseUrl(partial.apiBaseUrl);
  }

  const dir = vscode.Uri.joinPath(folder.uri, '.contexthud');
  await vscode.workspace.fs.createDirectory(dir);

  const content = JSON.stringify(defaults, null, 2) + '\n';
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  return defaults;
}
