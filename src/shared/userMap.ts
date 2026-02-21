import * as path from 'path';
import * as vscode from 'vscode';
import { UserMapping } from './types';

export async function loadUserMapping(): Promise<UserMapping> {
  const config = vscode.workspace.getConfiguration('contexthud');
  const relativePath = config.get<string>('userMappingPath', '.contexthud/users.json');
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    return {};
  }

  const mappingUri = vscode.Uri.joinPath(workspaceFolder.uri, relativePath);

  try {
    const bytes = await vscode.workspace.fs.readFile(mappingUri);
    const text = Buffer.from(bytes).toString('utf8');
    const parsed = JSON.parse(text) as UserMapping;
    return parsed;
  } catch {
    return {};
  }
}

export async function getCurrentUser(): Promise<string> {
  const configUser = vscode.workspace.getConfiguration('contexthud').get<string>('currentUser', '').trim();
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
  return path.join(workspacePath, '.contexthud', 'users.json');
}
