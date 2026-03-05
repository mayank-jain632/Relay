import * as path from 'path';
import * as vscode from 'vscode';
import { getRelayStringSetting } from './settings';

export interface RepoConfig {
  apiBaseUrl: string;
  projectId: string;
  baseBranch: string;
}

const RELAY_CONFIG_REL_PATH = path.join('.relay', 'config.json');
const LEGACY_CONFIG_REL_PATH = path.join('.contexthud', 'config.json');

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

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

function getConfigCandidates(folder: vscode.WorkspaceFolder): vscode.Uri[] {
  return [
    vscode.Uri.joinPath(folder.uri, RELAY_CONFIG_REL_PATH),
    vscode.Uri.joinPath(folder.uri, LEGACY_CONFIG_REL_PATH)
  ];
}

export async function getConfigUri(): Promise<vscode.Uri | undefined> {
  const folder = getWorkspaceFolder();
  if (!folder) {
    return undefined;
  }

  const candidates = getConfigCandidates(folder);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

export async function readRepoConfig(): Promise<RepoConfig | undefined> {
  const folder = getWorkspaceFolder();
  if (!folder) {
    return undefined;
  }

  const candidates = getConfigCandidates(folder);
  for (const uri of candidates) {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as Partial<RepoConfig>;
      if (!parsed.projectId) {
        continue;
      }

      return {
        apiBaseUrl: normalizeApiBaseUrl(parsed.apiBaseUrl || 'http://localhost:8787'),
        projectId: String(parsed.projectId),
        baseBranch: String(parsed.baseBranch || 'main')
      };
    } catch {
      // try next candidate
    }
  }

  return undefined;
}

export async function writeRepoConfig(partial?: Partial<RepoConfig>): Promise<RepoConfig> {
  const folder = getWorkspaceFolder();
  if (!folder) {
    throw new Error('Open a workspace folder first.');
  }

  const defaults: RepoConfig = {
    apiBaseUrl: normalizeApiBaseUrl(getRelayStringSetting('apiBaseUrl', 'http://localhost:8787')),
    projectId: partial?.projectId || '',
    baseBranch: partial?.baseBranch || 'main'
  };

  if (!defaults.projectId) {
    const enteredProjectId = await vscode.window.showInputBox({
      title: 'Initialize Relay (Manual)',
      prompt: 'Enter projectId (workspace UUID) from Relay dashboard',
      placeHolder: 'e.g. 17ae2df4-c247-48e5-9f94-e9870ea4fecf'
    });

    if (!enteredProjectId) {
      throw new Error('Project initialization cancelled.');
    }

    defaults.projectId = enteredProjectId.trim();
  }

  if (!partial?.apiBaseUrl) {
    const enteredApiBaseUrl = await vscode.window.showInputBox({
      title: 'Initialize Relay (Manual)',
      prompt: 'Enter hosted Relay API base URL',
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

  const relayDir = vscode.Uri.joinPath(folder.uri, '.relay');
  const relayConfigUri = vscode.Uri.joinPath(folder.uri, RELAY_CONFIG_REL_PATH);
  await vscode.workspace.fs.createDirectory(relayDir);

  const content = JSON.stringify(defaults, null, 2) + '\n';
  await vscode.workspace.fs.writeFile(relayConfigUri, Buffer.from(content, 'utf8'));

  const legacyConfigUri = vscode.Uri.joinPath(folder.uri, LEGACY_CONFIG_REL_PATH);
  if (await pathExists(legacyConfigUri)) {
    await vscode.workspace.fs.writeFile(legacyConfigUri, Buffer.from(content, 'utf8'));
  }

  return defaults;
}
