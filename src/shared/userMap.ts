import * as path from 'path';
import * as vscode from 'vscode';
import { UserMapping } from './types';
import { getRelayStringSetting } from './settings';

async function readMappingFile(uri: vscode.Uri): Promise<UserMapping | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    return JSON.parse(text) as UserMapping;
  } catch {
    return undefined;
  }
}

export async function loadUserMapping(): Promise<UserMapping> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return {};
  }

  const relativePath = getRelayStringSetting('userMappingPath', '.relay/users.json');
  const primaryUri = vscode.Uri.joinPath(workspaceFolder.uri, relativePath);
  const primary = await readMappingFile(primaryUri);
  if (primary) {
    return primary;
  }

  const legacyUri = vscode.Uri.joinPath(workspaceFolder.uri, '.contexthud', 'users.json');
  const legacy = await readMappingFile(legacyUri);
  return legacy || {};
}

export async function getCurrentUser(): Promise<string> {
  const configUser = getRelayStringSetting('currentUser', '').trim();
  if (configUser) {
    return configUser;
  }

  const localUser = process.env.GITHUB_USER || process.env.USER || process.env.USERNAME || '';
  return localUser.trim();
}

export function resolveAssigneeFromSlackId(mapping: UserMapping, slackId: string): string | undefined {
  return mapping[slackId];
}

export function getDefaultUserMappingPath(workspacePath: string): string {
  return path.join(workspacePath, '.relay', 'users.json');
}
