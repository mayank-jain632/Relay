import * as vscode from 'vscode';

const ACTIVE_TASK_KEY = 'contexthud.activeTaskId';

export function setActiveTaskId(state: vscode.Memento, taskId: string | undefined): Thenable<void> {
  return state.update(ACTIVE_TASK_KEY, taskId);
}

export function getActiveTaskId(state: vscode.Memento): string | undefined {
  return state.get<string>(ACTIVE_TASK_KEY);
}
