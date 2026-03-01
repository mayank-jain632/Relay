import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

export interface GitCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

export async function getRepoRoot(): Promise<string> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('Open a workspace folder to use Git actions.');
  }

  return runGit(['rev-parse', '--show-toplevel'], folder.uri.fsPath);
}

export async function getCurrentBranch(repoRoot: string): Promise<string> {
  return runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
}

export async function getHeadSha(repoRoot: string): Promise<string> {
  return runGit(['rev-parse', 'HEAD'], repoRoot);
}

export function slugify(input: string, maxLength = 50): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength)
    .replace(/-$/g, '');
}

export function buildBranchName(prefix: string, taskId: string, title: string): string {
  const safePrefix = (prefix || 'ch').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'ch';
  const shortId = taskId.slice(0, 8).toLowerCase();
  const slug = slugify(title || 'task');
  return `${safePrefix}/${shortId}-${slug}`;
}

export async function checkoutOrCreateBranch(repoRoot: string, branchName: string): Promise<{ created: boolean }> {
  try {
    await runGit(['checkout', '-b', branchName], repoRoot);
    return { created: true };
  } catch {
    await runGit(['checkout', branchName], repoRoot);
    return { created: false };
  }
}

export async function readCommit(repoRoot: string, sha: string): Promise<GitCommit> {
  const out = await runGit(['show', '-s', '--format=%H%n%s%n%an%n%cI', sha], repoRoot);
  const [fullSha, message, author, date] = out.split('\n');
  return {
    sha: fullSha || sha,
    message: message || '',
    author: author || '',
    date: date || new Date().toISOString()
  };
}

export async function showCommit(repoRoot: string, sha: string): Promise<string> {
  return runGit(['show', sha], repoRoot);
}

export async function showCommitDiff(repoRoot: string, sha: string): Promise<string> {
  try {
    return await runGit(['diff', `${sha}^!`], repoRoot);
  } catch {
    return showCommit(repoRoot, sha);
  }
}

export async function getChangedFilesForCommit(repoRoot: string, sha: string): Promise<string[]> {
  let output = '';
  try {
    output = await runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', sha], repoRoot);
  } catch {
    output = await runGit(['show', '--name-only', '--pretty=', sha], repoRoot);
  }

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function getRemoteOriginUrl(repoRoot: string): Promise<string> {
  return runGit(['remote', 'get-url', 'origin'], repoRoot);
}

export async function detectBaseBranch(repoRoot: string, fallback: string): Promise<string> {
  try {
    const ref = await runGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], repoRoot);
    const candidate = ref.split('/').pop();
    return candidate || fallback;
  } catch {
    return fallback || 'main';
  }
}

function normalizeGithubRemote(remote: string): { owner: string; repo: string } | null {
  const sshMatch = remote.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  const httpsMatch = remote.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  return null;
}

export function buildGitHubCompareUrl(remote: string, baseBranch: string, branchName: string): string | null {
  const parsed = normalizeGithubRemote(remote);
  if (!parsed) {
    return null;
  }

  return `https://github.com/${parsed.owner}/${parsed.repo}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branchName)}?expand=1`;
}

export async function showTaskDiff(repoRoot: string, baseBranch: string, branchName: string): Promise<string> {
  try {
    return await runGit(['diff', `origin/${baseBranch}...${branchName}`], repoRoot);
  } catch {
    return runGit(['diff', `${baseBranch}...${branchName}`], repoRoot);
  }
}
