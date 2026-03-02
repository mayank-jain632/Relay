import * as vscode from 'vscode';

const ACTIVE_TASK_KEY = 'relay.activeTaskId';
const LEGACY_ACTIVE_TASK_KEY = 'contexthud.activeTaskId';

export function setActiveTaskId(state: vscode.Memento, taskId: string | undefined): Thenable<void> {
  return Promise.all([
    state.update(ACTIVE_TASK_KEY, taskId),
    state.update(LEGACY_ACTIVE_TASK_KEY, taskId)
  ]).then(() => undefined);
}

export function getActiveTaskId(state: vscode.Memento): string | undefined {
  return state.get<string>(ACTIVE_TASK_KEY) || state.get<string>(LEGACY_ACTIVE_TASK_KEY);
}
