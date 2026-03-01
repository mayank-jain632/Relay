import * as path from 'path';
import * as vscode from 'vscode';
import { Task } from './types';

export function sortByOrder(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.orderIndex - b.orderIndex);
}

export function privateFilter(tasks: Task[], currentUser: string): Task[] {
  return tasks.filter((task) => task.assignee_id === currentUser);
}

export function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

export function getWorkspaceRelativePath(uri: vscode.Uri): string {
  const workspace = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspace) {
    return normalizeFilePath(uri.fsPath);
  }

  return normalizeFilePath(path.relative(workspace.uri.fsPath, uri.fsPath));
}

export function prioritizeByFile(tasks: Task[], activeRelativePath: string): Task[] {
  const normalized = normalizeFilePath(activeRelativePath);
  const idx = tasks.findIndex((task) =>
    (task.linkedFiles || []).some((file) => normalizeFilePath(file) === normalized)
  );

  if (idx <= 0) {
    return tasks;
  }

  const result = [...tasks];
  const [selected] = result.splice(idx, 1);
  result.unshift(selected);

  return result.map((task, orderIndex) => ({ ...task, orderIndex: orderIndex + 1 }));
}
