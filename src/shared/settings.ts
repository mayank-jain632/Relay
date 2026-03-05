import * as vscode from 'vscode';

export const RELAY_DEFAULT_API_BASE_URL = 'https://relay-production-9927.up.railway.app';

function normalizeString(value: string | undefined): string {
  return String(value || '').trim();
}

export function getRelayStringSetting(key: string, fallback: string): string {
  const relay = normalizeString(vscode.workspace.getConfiguration('relay').get<string>(key));
  if (relay) {
    return relay;
  }

  const legacy = normalizeString(vscode.workspace.getConfiguration('contexthud').get<string>(key));
  if (legacy) {
    return legacy;
  }

  return fallback;
}

export function getRelayNumberSetting(key: string, fallback: number): number {
  const relay = vscode.workspace.getConfiguration('relay').get<number>(key);
  if (relay !== undefined && relay !== null && Number.isFinite(relay)) {
    return Number(relay);
  }

  const legacy = vscode.workspace.getConfiguration('contexthud').get<number>(key);
  if (legacy !== undefined && legacy !== null && Number.isFinite(legacy)) {
    return Number(legacy);
  }

  return fallback;
}
