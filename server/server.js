const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { parseNudgeInput, parseSlackTaskText } = require('./lib/slack-parser');
const { loadEnv } = require('./lib/env');
const { resolveAssignee } = require('./lib/user-map');
const { healthCheck, initSchema, query } = require('./lib/db');
const {
  addCommit,
  backfillSlackAssigneeMapping,
  createTask,
  getTaskById,
  listTasks,
  nextOrderIndex,
  patchTask,
  summarizeTask,
  listTaskEvents,
  recordTaskEvent
} = require('./lib/task-repo');
const {
  getTaskByIdV2,
  getTaskBySlackThread,
  listTasksV2
} = require('./lib/task-repo-v2');
const taskServiceV2 = require('./lib/task-service-v2');
const { isTasksDualWriteEnabled, isTasksReadV2Enabled } = require('./lib/feature-flags');
const {
  addProjectMember,
  createProject,
  getProjectMembership,
  getUserById,
  getUserByLogin,
  isProjectMember,
  listProjectMembers,
  listProjectsForUser,
  listSlackUserMappings,
  resolveMappedUserBySlackId,
  upsertGitHubUser,
  upsertSlackUserMap
} = require('./lib/user-repo');
const {
  cleanupExpiredAuthArtifacts,
  completeVscodeLoginAttempt,
  consumeOAuthState,
  consumeVscodeLoginAttempt,
  createOAuthState,
  createVscodeLoginAttempt,
  signAuthToken,
  verifyAuthToken
} = require('./lib/auth-repo');
const {
  consumePairCode,
  consumeSlackAccountLink,
  createPairCode,
  createSlackAccountLink,
  createWorkspaceInvite,
  getOnboardingState,
  getSlackInstallationByWorkspaceId,
  getWorkspaceInvite,
  resolveProjectIdForSlack,
  touchSlackProjectEvent,
  upsertSlackInstallation
} = require('./lib/onboarding-repo');

const runtimeState = {
  startupInitError: null
};

function nowIso() {
  return new Date().toISOString();
}

function log(level, message, meta = {}) {
  const payload = {
    level,
    message,
    time: nowIso(),
    ...meta
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }

  console.log(line);
}

function makeRequestId() {
  return crypto.randomBytes(8).toString('hex');
}

function getBearerToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    return undefined;
  }

  return authHeader.slice('Bearer '.length).trim();
}

function secretFingerprint(value) {
  if (!value) {
    return 'empty';
  }

  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function normalizeSecret(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim();
  }

  return raw;
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function getDashboardBaseUrl(appBaseUrl) {
  return String(process.env.DASHBOARD_BASE_URL || appBaseUrl).trim().replace(/\/$/, '');
}

function getSlackRedirectUri(appBaseUrl) {
  return String(process.env.SLACK_REDIRECT_URI || `${appBaseUrl}/auth/slack/callback`).trim();
}

async function listTasksCompat(projectId, options = {}) {
  if (isTasksReadV2Enabled()) {
    return listTasksV2(projectId, options);
  }

  return listTasks(projectId, options);
}

async function getTaskByIdCompat(projectId, taskId) {
  if (isTasksReadV2Enabled()) {
    return getTaskByIdV2(projectId, taskId);
  }

  return getTaskById(projectId, taskId);
}

function applyTaskFilters(tasks, options = {}) {
  let output = Array.isArray(tasks) ? tasks.slice() : [];

  if (options.status) {
    const desired = String(options.status).trim().toLowerCase();
    output = output.filter((task) => String(task.status || '').toLowerCase() === desired);
  }

  if (options.assignee) {
    const desired = String(options.assignee).trim().toLowerCase();
    output = output.filter((task) => String(task.assignee_id || '').toLowerCase() === desired);
  }

  return output;
}

function isLikelySlackUserId(value) {
  return /^[UW][A-Z0-9]+$/i.test(String(value || '').trim());
}

function hashCompact(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 20);
}

function buildSlackThreadIdentity(payload) {
  const threadTs = String(payload?.thread_ts || '').trim();
  if (threadTs) {
    return { threadTs, synthetic: false };
  }

  const messageTs = String(payload?.message_ts || '').trim();
  if (messageTs) {
    return { threadTs: `msg:${messageTs}`, synthetic: true };
  }

  const responseUrl = String(payload?.response_url || '').trim();
  if (responseUrl) {
    return { threadTs: `cmd:${hashCompact(responseUrl)}`, synthetic: true };
  }

  return null;
}

async function getSlackBotTokenForWorkspace(workspaceId) {
  const workspace = String(workspaceId || '').trim();
  if (workspace) {
    const installation = await getSlackInstallationByWorkspaceId(workspace);
    if (installation?.bot_token) {
      return String(installation.bot_token);
    }
  }

  const fallbackToken = String(process.env.SLACK_BOT_TOKEN || '').trim();
  return fallbackToken || '';
}

async function postSlackMessage({ workspaceId, channelId, text, threadTs }) {
  const token = await getSlackBotTokenForWorkspace(workspaceId);
  if (!token || !channelId) {
    return null;
  }

  const payload = {
    channel: channelId,
    text
  };

  if (threadTs) {
    payload.thread_ts = threadTs;
  }

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok || !result.ok) {
      return `Slack API error: ${result?.error || `HTTP ${response.status}`}`;
    }

    return null;
  } catch (error) {
    return `Slack API error: ${String(error?.message || error)}`;
  }
}

async function fetchSlackUserProfile(workspaceId, slackUserId) {
  const raw = String(slackUserId || '').trim();
  if (!raw || !isLikelySlackUserId(raw)) {
    const handle = raw.replace(/^@+/, '');
    return handle
      ? {
          id: raw,
          handle,
          displayName: handle,
          realName: null,
          avatarUrl: null
        }
      : null;
  }

  const token = await getSlackBotTokenForWorkspace(workspaceId);
  if (!token) {
    return null;
  }

  try {
    const response = await fetch('https://slack.com/api/users.info?user=' + encodeURIComponent(raw), {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token
      }
    });

    const result = await response.json();
    if (!response.ok || !result?.ok || !result?.user) {
      return {
        id: raw,
        handle: raw,
        displayName: raw,
        realName: null,
        avatarUrl: null
      };
    }

    const user = result.user;
    const profile = user.profile || {};
    return {
      id: raw,
      handle: String(user.name || '').trim() || raw,
      displayName: String(profile.display_name || profile.real_name || user.real_name || user.name || raw).trim(),
      realName: String(profile.real_name || user.real_name || '').trim() || null,
      avatarUrl: String(profile.image_72 || profile.image_48 || profile.image_32 || '').trim() || null
    };
  } catch {
    return {
      id: raw,
      handle: raw,
      displayName: raw,
      realName: null,
      avatarUrl: null
    };
  }
}

async function sendSlackAccountLink(projectId, slackWorkspaceId, slackUserId, appBaseUrl) {
  if (!projectId || !isLikelySlackUserId(slackUserId)) {
    return null;
  }

  const token = await createSlackAccountLink(projectId, String(slackUserId).trim().toUpperCase());
  const linkUrl = `${appBaseUrl}/auth/slack/link/${token}`;
  const text = `Relay: link your account to auto-assign tasks. ${linkUrl}`;

  return postSlackMessage({
    workspaceId: slackWorkspaceId,
    channelId: String(slackUserId).trim().toUpperCase(),
    text
  });
}

async function exchangeSlackCodeForToken(code, appBaseUrl) {
  const params = new URLSearchParams();
  params.set('client_id', requireEnv('SLACK_CLIENT_ID'));
  params.set('client_secret', requireEnv('SLACK_CLIENT_SECRET'));
  params.set('code', code);
  params.set('redirect_uri', getSlackRedirectUri(appBaseUrl));

  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const data = await response.json();
  if (!response.ok || !data?.ok) {
    throw new Error(`Slack OAuth failed: ${data?.error || response.status}`);
  }

  return data;
}

function formatStatus(status) {
  return String(status || 'todo').replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildStatusMessage(task) {
  const assignee = task.assignee_id ? `@${task.assignee_id}` : 'assignee';
  const statusLabel = formatStatus(task.status);
  const branchPart = task.branchName ? ` (branch: ${task.branchName})` : '';
  const prPart = task.prUrl ? ` (${task.prUrl})` : '';

  if (task.status === 'in_progress') {
    return `🟦 Relay: ${assignee} started this task -> ${statusLabel}${branchPart}`;
  }

  if (task.status === 'review') {
    return `🟨 Relay: PR opened -> ${statusLabel}${branchPart}${prPart}`;
  }

  if (task.status === 'done') {
    return `✅ Relay: Marked ${statusLabel}${branchPart}`;
  }

  if (task.status === 'blocked') {
    return `⛔ Relay: Status updated -> ${statusLabel}${branchPart}`;
  }

  return `🔄 Relay: Status updated -> ${statusLabel}${branchPart}`;
}

async function safeRecordTaskEvent(req, event) {
  try {
    await recordTaskEvent(event);
  } catch (error) {
    log('error', 'task_event_record_failed', {
      requestId: req?.requestId,
      taskId: event?.taskId,
      eventType: event?.eventType,
      error: String(error?.message || error)
    });
  }
}

async function postStatusToSlack(task) {
  if (!task.slackChannelId) {
    return null;
  }

  return postSlackMessage({
    workspaceId: task.slackWorkspaceId,
    channelId: task.slackChannelId,
    threadTs: task.slackThreadTs,
    text: buildStatusMessage(task)
  });
}

function verifySlackSignature(req) {
  const signingSecret = String(process.env.SLACK_SIGNING_SECRET || '').trim();
  if (!signingSecret) {
    return false;
  }

  const timestamp = String(req.headers['x-slack-request-timestamp'] || '').trim();
  const signature = String(req.headers['x-slack-signature'] || '').trim();
  const rawBody = String(req.rawBody || '');

  if (!timestamp || !signature || !rawBody) {
    return false;
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return false;
  }

  const ageSec = Math.abs(Date.now() / 1000 - ts);
  if (ageSec > 300) {
    return false;
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = `v0=${crypto.createHmac('sha256', signingSecret).update(base).digest('hex')}`;

  const sigBuf = Buffer.from(signature);
  const digestBuf = Buffer.from(digest);
  if (sigBuf.length !== digestBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuf, digestBuf);
}

function verifyGitHubSignature(req) {
  const secret = normalizeSecret(process.env.GITHUB_WEBHOOK_SECRET);
  if (!secret) {
    return { ok: false, reason: 'missing_secret' };
  }

  const signature = String(req.headers['x-hub-signature-256'] || '').trim();
  const rawBody = String(req.rawBody || '');
  if (!signature || !rawBody) {
    return { ok: false, reason: 'missing_signature' };
  }

  const digest = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const signatureBuf = Buffer.from(signature);
  const digestBuf = Buffer.from(digest);
  if (signatureBuf.length !== digestBuf.length) {
    return { ok: false, reason: 'invalid_signature' };
  }

  const valid = crypto.timingSafeEqual(signatureBuf, digestBuf);
  return valid ? { ok: true } : { ok: false, reason: 'invalid_signature' };
}

function buildGitHubCompareCandidates(repoFullName, baseRef, headRef) {
  const repo = String(repoFullName || '').trim().toLowerCase();
  const base = String(baseRef || '').trim();
  const head = String(headRef || '').trim();
  if (!repo || !base || !head) {
    return [];
  }

  const encoded = `https://github.com/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
  const raw = `https://github.com/${repo}/compare/${base}...${head}`;
  return Array.from(
    new Set([encoded, `${encoded}?expand=1`, raw, `${raw}?expand=1`].map((item) => item.toLowerCase()))
  );
}
function extractRepoFullNameFromGitHubUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/github\.com\/([^\/]+)\/([^\/?#]+)/i);
  if (!match) {
    return null;
  }

  return (match[1] + '/' + match[2]).toLowerCase();
}


async function findAutoCloseTasksForMergedPr({ branchName, repoFullName, compareCandidates, prUrl }) {
  const branch = String(branchName || '').trim();
  const repo = String(repoFullName || '').trim().toLowerCase();
  const prUrlValue = String(prUrl || '').trim().toLowerCase();
  const compare = Array.isArray(compareCandidates) && compareCandidates.length > 0 ? compareCandidates : [''];

  if (!branch && !prUrlValue && compare.every((item) => !item)) {
    return [];
  }

  const repoPattern = repo ? `%github.com/${repo}/%` : '';
  const result = await query(
    `SELECT id, project_id
     FROM tasks
     WHERE auto_close_on_merge = TRUE
       AND status <> 'done'
       AND (
         (
           LOWER(COALESCE(branch_name, '')) = LOWER($1)
           AND ($2 = '' OR LOWER(COALESCE(pr_url, '')) LIKE $2)
         )
         OR LOWER(COALESCE(pr_url, '')) = ANY($3::text[])
         OR ($4 <> '' AND LOWER(COALESCE(pr_url, '')) = $4)
       )
     ORDER BY updated_at DESC
     LIMIT 200`,
    [branch, repoPattern, compare, prUrlValue]
  );

  return result.rows.map((row) => ({
    id: row.id,
    projectId: row.project_id
  }));
}

async function findTasksForPullRequest({ repoFullName, headRef, prNumber, prUrl }) {
  const repo = String(repoFullName || '').trim().toLowerCase();
  const branch = String(headRef || '').trim();
  const number = Number.isFinite(Number(prNumber)) ? Number(prNumber) : null;
  const prUrlValue = String(prUrl || '').trim().toLowerCase();

  const result = await query(
    `SELECT DISTINCT t.id, t.project_id
       FROM tasks t
       LEFT JOIN task_links_github g ON g.task_id = t.id
      WHERE (
        ($1 <> '' AND LOWER(COALESCE(g.repo_full_name, '')) = $1 AND ($2::int IS NOT NULL AND g.pr_number = $2))
        OR ($1 <> '' AND LOWER(COALESCE(g.repo_full_name, '')) = $1 AND $3 <> '' AND LOWER(COALESCE(g.branch_name, '')) = LOWER($3))
        OR ($3 <> '' AND LOWER(COALESCE(t.branch_name, '')) = LOWER($3))
        OR ($4 <> '' AND LOWER(COALESCE(g.pr_url, '')) = $4)
        OR ($4 <> '' AND LOWER(COALESCE(t.pr_url, '')) = $4)
      )
      ORDER BY t.updated_at DESC
      LIMIT 300`,
    [repo, number, branch, prUrlValue]
  );

  return result.rows.map((row) => ({ id: row.id, projectId: row.project_id }));
}

async function syncTaskStatusFromPullRequest(req, payload) {
  const pullRequest = payload?.pull_request || {};
  const repoFullName = String(
    pullRequest?.base?.repo?.full_name || payload?.repository?.full_name || ''
  ).trim().toLowerCase();
  const headRef = String(pullRequest?.head?.ref || '').trim();
  const prUrl = String(pullRequest?.html_url || '').trim();
  const prNumber = pullRequest?.number;
  const prState = pullRequest?.merged ? 'merged' : String(pullRequest?.state || 'open').trim().toLowerCase();

  if (!repoFullName && !headRef && !prUrl) {
    return { matched: 0, updated: 0 };
  }

  const candidates = await findTasksForPullRequest({
    repoFullName,
    headRef,
    prNumber,
    prUrl
  });

  let updated = 0;
  for (const candidate of candidates) {
    if (repoFullName) {
      await taskServiceV2.linkGitHub({
        taskId: candidate.id,
        repoFullName,
        branchName: headRef || null,
        prNumber: prNumber || null,
        prUrl: prUrl || null,
        prState
      });
    }

    const before = await getTaskById(candidate.projectId, candidate.id);
    const next = await taskServiceV2.setStatusFromGitHub({
      taskId: candidate.id,
      projectId: candidate.projectId,
      prState,
      prUrl: prUrl || null
    });

    if (before && next && before.status !== next.status) {
      updated += 1;
      const warning = await postStatusToSlack(next);
      if (warning) {
        log('error', 'slack_status_post_failed', {
          requestId: req.requestId,
          taskId: next.id,
          warning
        });
      }

      await safeRecordTaskEvent(req, {
        projectId: candidate.projectId,
        taskId: next.id,
        actorUserId: null,
        actorLabel: 'github-webhook',
        eventType: 'task.status_synced_from_github',
        summary: 'Status synced from GitHub PR state',
        metadata: {
          prState,
          pullRequestUrl: prUrl || null,
          repository: repoFullName || null,
          branch: headRef || null,
          prNumber: prNumber || null
        }
      });
    }
  }

  return { matched: candidates.length, updated };
}

async function autoCloseTasksForMergedPullRequest(req, payload) {
  const action = String(payload?.action || '').trim().toLowerCase();
  const pullRequest = payload?.pull_request || {};
  if (action !== 'closed' || !pullRequest?.merged) {
    return { matched: 0, updated: 0, ignored: 'not_merged_pull_request' };
  }

  const repoFullName = String(
    pullRequest?.base?.repo?.full_name || payload?.repository?.full_name || ''
  ).trim().toLowerCase();
  const headRef = String(pullRequest?.head?.ref || '').trim();
  const baseRef = String(pullRequest?.base?.ref || '').trim();
  const prUrl = String(pullRequest?.html_url || '').trim();

  const candidates = await findAutoCloseTasksForMergedPr({
    branchName: headRef,
    repoFullName,
    compareCandidates: buildGitHubCompareCandidates(repoFullName, baseRef, headRef),
    prUrl
  });

  let updated = 0;
  for (const candidate of candidates) {
    const before = await getTaskById(candidate.projectId, candidate.id);
    if (!before || before.status === 'done' || !before.autoCloseOnMerge) {
      continue;
    }

    const patch = {
      status: 'done',
      updatedByUserId: null,
      prUrl: prUrl || before.prUrl || null
    };

    const task = await patchTask(candidate.projectId, candidate.id, patch);
    if (!task || before.status === task.status) {
      continue;
    }

    updated += 1;
    const warning = await postStatusToSlack(task);
    if (warning) {
      log('error', 'slack_status_post_failed', {
        requestId: req.requestId,
        taskId: task.id,
        warning
      });
    }

    await safeRecordTaskEvent(req, {
      projectId: candidate.projectId,
      taskId: task.id,
      actorUserId: null,
      actorLabel: 'github-webhook',
      eventType: 'task.auto_closed_on_merge',
      summary: 'Auto-closed after PR merged',
      metadata: {
        pullRequestUrl: prUrl || null,
        repository: repoFullName || null,
        baseRef: baseRef || null,
        headRef: headRef || null
      }
    });
  }

  return {
    matched: candidates.length,
    updated,
    ignored: updated === 0 ? 'no_matching_auto_close_tasks' : null
  };
}

function renderAuthSuccessPage(options = {}) {
  const autoCompleteUrl = String(options.autoCompleteUrl || '').trim();
  const escapedAutoCompleteUrl = autoCompleteUrl
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");

  const autoScript = autoCompleteUrl
    ? `
    <script>
      (function () {
        var completeUrl = '${escapedAutoCompleteUrl}';

        function finalizeCurrentTab() {
          setTimeout(function () {
            window.location.href = completeUrl;
          }, 400);
        }

        try {
          if (window.opener && !window.opener.closed) {
            window.opener.location.href = completeUrl;
            window.close();
            return;
          }
        } catch (error) {
          // cross-origin opener access can fail; fallback to current tab redirect
        }

        finalizeCurrentTab();
      })();
    </script>
    `
    : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Relay Sign In</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; background: #0f172a; color: #e2e8f0; display: grid; place-items: center; height: 100vh; margin: 0; }
      .card { border: 1px solid #1e293b; background: #111827; border-radius: 10px; padding: 22px; max-width: 560px; }
      h1 { margin: 0 0 8px; font-size: 20px; }
      p { margin: 0; color: #94a3b8; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>✅ Signed in to Relay</h1>
      <p>You can close this tab and return to your app.</p>
    </div>
    ${autoScript}
  </body>
</html>`;
}


async function exchangeGitHubCodeForToken(code, appBaseUrl) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: requireEnv('GITHUB_CLIENT_ID'),
      client_secret: requireEnv('GITHUB_CLIENT_SECRET'),
      code,
      redirect_uri: `${appBaseUrl}/auth/github/callback`
    })
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`GitHub token exchange failed: ${data?.error || response.status}`);
  }

  return String(data.access_token);
}

async function fetchGitHubProfile(accessToken) {
  const profileResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'relay',
      Accept: 'application/vnd.github+json'
    }
  });

  if (!profileResponse.ok) {
    throw new Error(`Failed to fetch GitHub profile: ${profileResponse.status}`);
  }

  const profile = await profileResponse.json();

  let email = profile.email || null;
  if (!email) {
    const emailResponse = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'relay',
        Accept: 'application/vnd.github+json'
      }
    });

    if (emailResponse.ok) {
      const emails = await emailResponse.json();
      const primary = Array.isArray(emails)
        ? emails.find((item) => item?.primary && item?.verified) || emails.find((item) => item?.verified)
        : null;
      email = primary?.email || null;
    }
  }

  return {
    id: String(profile.id || ''),
    login: String(profile.login || '').toLowerCase(),
    name: profile.name || profile.login || null,
    avatar_url: profile.avatar_url || null,
    email
  };
}

function normalizeRole(role) {
  const value = String(role || 'member').trim().toLowerCase();
  if (value === 'owner') {
    return 'owner';
  }
  return 'member';
}

function parseAdminLogins() {
  return new Set(
    String(process.env.ADMIN_GITHUB_LOGINS || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

function hasValidAdminKey(req, options = { logMismatch: false }) {
  const expected = normalizeSecret(process.env.ADMIN_API_KEY);
  const headerKey = normalizeSecret(req.headers['x-admin-api-key']);
  const bearerKey = normalizeSecret(getBearerToken(req));
  const queryKey = normalizeSecret(req.query?.adminKey);
  const source = headerKey ? 'header' : bearerKey ? 'bearer' : queryKey ? 'query' : 'none';
  const actual = headerKey || bearerKey || queryKey;

  if (!expected || !actual) {
    return { ok: false, reason: !expected ? 'server_missing' : 'request_missing', source };
  }

  if (expected !== actual) {
    if (options.logMismatch) {
      log('error', 'admin_key_mismatch', {
        requestId: req.requestId,
        source,
        expectedLength: expected.length,
        actualLength: actual.length,
        expectedFingerprint: secretFingerprint(expected),
        actualFingerprint: secretFingerprint(actual)
      });
    }

    return { ok: false, reason: 'mismatch', source };
  }

  return { ok: true, source };
}

function isPlatformAdmin(req) {
  const byKey = hasValidAdminKey(req, { logMismatch: false });
  if (byKey.ok) {
    return true;
  }

  const admins = parseAdminLogins();
  if (admins.size === 0) {
    return false;
  }

  return admins.has(String(req.user?.login || '').toLowerCase());
}

async function ingestSlackTask(projectId, payload, appBaseUrl) {
  const parsed = parseSlackTaskText(payload.text || '');

  const mapped =
    (await resolveMappedUserBySlackId(projectId, parsed.assigneeRef)) ||
    (await resolveMappedUserBySlackId(projectId, payload.user_id));

  let fallbackAssignee = resolveAssignee(parsed.assigneeRef) || parsed.assigneeRef;
  if (!mapped && isLikelySlackUserId(parsed.assigneeRef)) {
    const slackProfile = await fetchSlackUserProfile(payload.team_id || null, parsed.assigneeRef);
    if (slackProfile?.handle) {
      fallbackAssignee = slackProfile.handle;
    } else if (slackProfile?.displayName) {
      fallbackAssignee = slackProfile.displayName;
    }
  }
  const assigneeId = mapped?.login || fallbackAssignee;
  const assignedToUserId = mapped?.userId || null;
  const slackThreadIdentity = buildSlackThreadIdentity(payload);

  const canUseSlackThreadIdentity =
    isTasksDualWriteEnabled() &&
    String(payload.team_id || '').trim() &&
    String(payload.channel_id || '').trim() &&
    String(slackThreadIdentity?.threadTs || '').trim();

  if (canUseSlackThreadIdentity) {
    const existingTask = await getTaskBySlackThread(
      projectId,
      String(payload.team_id || '').trim(),
      String(payload.channel_id || '').trim(),
      String(slackThreadIdentity?.threadTs || '').trim()
    );

    if (existingTask) {
      return {
        ok: true,
        response_type: 'in_channel',
        task: existingTask,
        text: 'Task already exists for this Slack thread: ' + existingTask.title
      };
    }
  }

  const task = await createTask({
    projectId,
    assignee_id: assigneeId,
    assignedToUserId,
    pendingSlackAssignee: mapped ? null : parsed.assigneeRef,
    createdByUserId: null,
    updatedByUserId: null,
    description: parsed.description,
    dueDate: parsed.dueDate,
    linkedFiles: parsed.linkedFiles,
    orderIndex: await nextOrderIndex(projectId, assigneeId),
    priority: parsed.priority || 'normal',
    slackChannelId: payload.channel_id || null,
    slackThreadTs: payload.thread_ts || null,
    slackWorkspaceId: payload.team_id || null,
    slackUserId: parsed.assigneeRef || null,
    source: 'slack',
    sourceUrl: payload.response_url || null,
    status: 'todo',
    title: parsed.title
  });

  if (isTasksDualWriteEnabled() && payload.team_id && payload.channel_id && slackThreadIdentity?.threadTs) {
    await taskServiceV2.linkSlackThread({
      taskId: task.id,
      slackTeamId: payload.team_id,
      slackChannelId: payload.channel_id,
      slackThreadTs: slackThreadIdentity.threadTs,
      slackMessageTs: payload.message_ts || null
    });
  }

  await touchSlackProjectEvent(projectId, payload.team_id || null, payload.channel_id || null);

  await recordTaskEvent({
    projectId,
    taskId: task.id,
    actorUserId: null,
    actorLabel: payload.user_name || payload.user_id || 'Slack',
    eventType: 'task.created_from_slack',
    summary: 'Updated from Slack message',
    metadata: {
      source: 'slack',
      channelId: payload.channel_id || null,
      threadTs: payload.thread_ts || null
    }
  });

  if (!mapped && isLikelySlackUserId(parsed.assigneeRef) && appBaseUrl) {
    const warning = await sendSlackAccountLink(projectId, payload.team_id || null, parsed.assigneeRef, appBaseUrl);
    if (warning) {
      log('error', 'slack_account_link_send_failed', {
        projectId,
        slackUserId: parsed.assigneeRef,
        warning
      });
    }
  }

  return {
    ok: true,
    response_type: 'in_channel',
    task,
    text: `Task created for ${task.assignee_id}: ${task.title}`
  };
}

function normalizeSlackIngestPayload(payload) {
  const body = payload || {};
  const event = body.event || {};

  return {
    text: String(event.text || body.text || ''),
    user_id: String(event.user || body.user_id || ''),
    channel_id: String(event.channel || body.channel_id || ''),
    thread_ts: String(event.thread_ts || event.ts || body.thread_ts || ''),
    team_id: String((body.team && body.team.id) || body.team_id || ''),
    response_url: String(body.response_url || '')
  };
}

function createApp() {
  loadEnv();

  const app = express();
  app.disable('x-powered-by');

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf?.toString('utf8') || '';
      }
    })
  );

  app.use(
    express.urlencoded({
      extended: false,
      verify: (req, _res, buf) => {
        req.rawBody = buf?.toString('utf8') || '';
      }
    })
  );

  app.use((req, res, next) => {
    const requestId = makeRequestId();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const origin = String(req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Vscode-Login-Id, X-Admin-Api-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    const started = Date.now();
    res.on('finish', () => {
      log('info', 'request', {
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - started
      });
    });

    next();
  });

  const appBaseUrl = String(process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 8787}`).replace(/\/$/, '');

  async function resolveProjectIdFromSlackPayload(payload, fallbackProjectId) {
    const workspaceId = String(payload?.team_id || '').trim();
    const channelId = String(payload?.channel_id || '').trim();
    const explicit = String(fallbackProjectId || '').trim();

    // Prefer workspace/channel resolution whenever Slack provides workspace context.
    // This prevents cross-project task ingestion if a stale project-scoped URL is used.
    if (workspaceId) {
      const resolved = await resolveProjectIdForSlack(workspaceId, channelId || null);
      if (resolved) {
        return resolved;
      }
    }

    // Legacy fallback for older integrations that only pass a project-scoped URL.
    if (explicit) {
      return explicit;
    }

    return null;
  }

  async function requireAuth(req, res, next) {
    try {
      const token = getBearerToken(req);
      if (!token) {
        return res.status(401).json({ error: 'Missing bearer token' });
      }

      const user = await verifyAuthToken(token);
      if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  }

  async function requireProjectMembership(req, res, next) {
    try {
      const projectId = String(req.params.projectId || req.params.id || '').trim();
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }

      const member = await getProjectMembership(projectId, req.user.userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a project member' });
      }

      req.projectId = projectId;
      req.projectMembership = member;
      next();
    } catch (error) {
      next(error);
    }
  }

  function requireProjectOwnerOrAdmin(req, res, next) {
    if (isPlatformAdmin(req)) {
      return next();
    }

    if (String(req.projectMembership?.role || '').toLowerCase() === 'owner') {
      return next();
    }

    return res.status(403).json({ error: 'Owner role required' });
  }

  function requireAdmin(req, res, next) {
    const result = hasValidAdminKey(req, { logMismatch: true });
    if (!result.ok) {
      return res.status(401).json({ error: 'Invalid admin key', reason: result.reason, source: result.source });
    }

    return next();
  }

  function requirePlatformAdmin(req, res, next) {
    if (!isPlatformAdmin(req)) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    return next();
  }

  app.get('/health/live', (_req, res) => {
    res.json({ ok: true, service: 'alive' });
  });

  app.get('/health', async (_req, res) => {
    let connected = false;
    let dbError = null;

    try {
      connected = await healthCheck();
    } catch (error) {
      dbError = String(error?.message || error);
    }

    const startupError = runtimeState.startupInitError
      ? String(runtimeState.startupInitError.message || runtimeState.startupInitError)
      : null;

    const ok = connected && !startupError;
    return res.status(ok ? 200 : 503).json({
      ok,
      db: connected ? 'connected' : 'disconnected',
      startupError,
      dbError
    });
  });

  const handleVscodeAuthStart = async (_req, res, next) => {
    try {
      requireEnv('GITHUB_CLIENT_ID');
      requireEnv('GITHUB_CLIENT_SECRET');
      requireEnv('SESSION_SECRET');

      const attempt = await createVscodeLoginAttempt();
      const loginUrl = `${appBaseUrl}/auth/github/login?source=vscode&loginId=${encodeURIComponent(attempt.id)}`;
      return res.json({ ok: true, loginId: attempt.id, loginUrl });
    } catch (error) {
      return next(error);
    }
  };

  app.post('/auth/vscode/start', handleVscodeAuthStart);
  app.get('/auth/vscode/start', handleVscodeAuthStart);

  app.get('/auth/github/login', async (req, res, next) => {
    try {
      requireEnv('GITHUB_CLIENT_ID');
      requireEnv('GITHUB_CLIENT_SECRET');
      requireEnv('SESSION_SECRET');

      const source = String(req.query.source || '').trim() || null;
      const loginId = String(req.query.loginId || '').trim() || null;
      const state = await createOAuthState(source, loginId);

      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', requireEnv('GITHUB_CLIENT_ID'));
      url.searchParams.set('redirect_uri', `${appBaseUrl}/auth/github/callback`);
      url.searchParams.set('scope', 'read:user user:email');
      url.searchParams.set('state', state);

      return res.redirect(url.toString());
    } catch (error) {
      return next(error);
    }
  });

  app.get('/auth/slack/link/:token', async (req, res) => {
    const token = String(req.params.token || '').trim();
    if (!token) {
      return res.status(400).send('Invalid link token.');
    }

    const url = new URL(`${appBaseUrl}/auth/github/login`);
    url.searchParams.set('source', 'slack_link');
    url.searchParams.set('loginId', token);
    return res.redirect(url.toString());
  });

  app.get('/auth/slack/callback', async (req, res, next) => {
    try {
      const code = String(req.query.code || '').trim();
      const state = String(req.query.state || '').trim();

      if (!code || !state) {
        return res.status(400).send('Missing code or state.');
      }

      const oauthState = await consumeOAuthState(state);
      if (!oauthState || oauthState.source !== 'slack_install') {
        return res.status(400).send('Invalid or expired Slack install state.');
      }

      const [projectId, installedByUserId] = String(oauthState.login_id || '').split(':');
      if (!projectId) {
        return res.status(400).send('Missing project context for Slack install.');
      }

      const data = await exchangeSlackCodeForToken(code, appBaseUrl);
      const workspaceId = String(data?.team?.id || '').trim();
      if (!workspaceId) {
        return res.status(400).send('Slack install did not return a workspace ID.');
      }

      await upsertSlackInstallation({
        slackWorkspaceId: workspaceId,
        enterpriseId: data?.enterprise?.id || null,
        teamName: data?.team?.name || null,
        appId: data?.app_id || null,
        accessToken: data?.access_token || null,
        botToken: data?.access_token || null,
        botUserId: data?.bot_user_id || null,
        projectId,
        installedByUserId: installedByUserId || null
      });

      // Slack connect is the authoritative project binding for a workspace.
      // Rebind this project row explicitly to prevent stale cross-workspace routing.
      await query(
        `INSERT INTO slack_project_config (project_id, slack_workspace_id, default_channel_id, last_event_at, created_at)
         VALUES ($1, $2, NULL, NOW(), NOW())
         ON CONFLICT(project_id)
         DO UPDATE SET
           slack_workspace_id = EXCLUDED.slack_workspace_id,
           last_event_at = NOW()`,
        [projectId, workspaceId]
      );
      const dashboardBaseUrl = getDashboardBaseUrl(appBaseUrl);
      return res.redirect(`${dashboardBaseUrl}/projects/${projectId}/integrations/slack?connected=1`);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/auth/github/callback', async (req, res, next) => {
    try {
      const code = String(req.query.code || '').trim();
      const state = String(req.query.state || '').trim();

      if (!code || !state) {
        return res.status(400).send('Missing code or state.');
      }

      const oauthState = await consumeOAuthState(state);
      if (!oauthState) {
        return res.status(400).send('Invalid or expired OAuth state.');
      }

      const accessToken = await exchangeGitHubCodeForToken(code, appBaseUrl);
      const profile = await fetchGitHubProfile(accessToken);
      const user = await upsertGitHubUser(profile);
      const token = signAuthToken(user);

      if (oauthState.source === 'vscode' && oauthState.login_id) {
        await completeVscodeLoginAttempt(oauthState.login_id, user.userId, token);
        return res.status(200).send(renderAuthSuccessPage({ autoCompleteUrl: `${getDashboardBaseUrl(appBaseUrl)}/auth/complete` }));
      }

      if (oauthState.source === 'slack_link' && oauthState.login_id) {
        const link = await consumeSlackAccountLink(oauthState.login_id);
        if (!link) {
          return res.status(400).send('This Slack link has expired. Ask Relay bot for a new link.');
        }

        await upsertSlackUserMap(link.projectId, link.slackUserId, user);
        await backfillSlackAssigneeMapping(link.projectId, link.slackUserId, user);
        return res.status(200).send(renderAuthSuccessPage());
      }

      return res.json({ ok: true, token, user });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/auth/github/token', async (req, res, next) => {
    try {
      const loginId = String(req.query.loginId || '').trim();
      const completed = await consumeVscodeLoginAttempt(loginId);
      if (!completed) {
        return res.status(401).json({ error: 'Not authenticated yet.' });
      }

      const user = await getUserById(completed.userId);
      if (!user) {
        return res.status(401).json({ error: 'Authentication failed.' });
      }

      return res.json({ ok: true, token: completed.token, user });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/me', requireAuth, async (req, res) => {
    res.json(req.user);
  });

  app.get('/api/capabilities', requireAuth, async (_req, res) => {
    return res.json({
      relayNativeTasks: true,
      readV2: isTasksReadV2Enabled(),
      dualWrite: isTasksDualWriteEnabled()
    });
  });

  app.get('/api/tasks', requireAuth, async (req, res, next) => {
    try {
      const projectId = String(req.query.workspace_id || req.query.workspaceId || req.query.project_id || req.query.projectId || '').trim();
      if (!projectId) {
        return res.status(400).json({ error: 'workspace_id is required' });
      }

      const member = await isProjectMember(projectId, req.user.userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a project member' });
      }

      const assigned = String(req.query.assigned || 'me').trim().toLowerCase();
      const options = assigned === 'all' ? {} : { assignedToUserId: req.user.userId };
      const tasks = await listTasksCompat(projectId, options);
      const filtered = applyTaskFilters(tasks, {
        status: req.query.status,
        assignee: req.query.assignee
      });
      return res.json({ tasks: filtered });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/tasks/:id', requireAuth, async (req, res, next) => {
    try {
      const taskId = String(req.params.id || '').trim();
      const projectId = String(req.query.workspace_id || req.query.workspaceId || req.query.project_id || req.query.projectId || '').trim();
      if (!projectId) {
        return res.status(400).json({ error: 'workspace_id is required' });
      }

      const member = await isProjectMember(projectId, req.user.userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a project member' });
      }

      const task = await getTaskByIdCompat(projectId, taskId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      return res.json({ task });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/tasks', requireAuth, async (req, res, next) => {
    try {
      const body = req.body || {};
      const projectId = String(body.workspaceId || body.workspace_id || body.projectId || body.project_id || '').trim();
      if (!projectId) {
        return res.status(400).json({ error: 'workspaceId is required' });
      }

      const member = await isProjectMember(projectId, req.user.userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a project member' });
      }

      const title = String(body.title || '').trim();
      if (!title) {
        return res.status(400).json({ error: 'title is required' });
      }

      const task = await taskServiceV2.createTask({
        projectId,
        assignee_id: String(body.assignee_id || '').trim() || null,
        assignedToUserId: String(body.assignedToUserId || '').trim() || null,
        pendingSlackAssignee: null,
        createdByUserId: req.user.userId,
        updatedByUserId: req.user.userId,
        description: String(body.description || '').trim() || title,
        dueDate: body.dueDate || null,
        linkedFiles: Array.isArray(body.linkedFiles) ? body.linkedFiles : [],
        priority: String(body.priority || 'normal').trim().toLowerCase(),
        source: String(body.source || 'api').trim().toLowerCase(),
        status: String(body.status || 'todo').trim().toLowerCase(),
        title
      });

      return res.status(201).json({ ok: true, task });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/tasks/:id/start', requireAuth, async (req, res, next) => {
    try {
      const taskId = String(req.params.id || '').trim();
      const body = req.body || {};
      const projectId = String(body.workspaceId || body.workspace_id || body.projectId || body.project_id || '').trim();
      if (!projectId) {
        return res.status(400).json({ error: 'workspaceId is required' });
      }

      const member = await isProjectMember(projectId, req.user.userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a project member' });
      }

      const before = await getTaskByIdCompat(projectId, taskId);
      if (!before) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const patch = {
        status: before.status === 'done' ? 'done' : 'in_progress',
        updatedByUserId: req.user.userId,
        branchName: body.branchName !== undefined ? body.branchName : before.branchName
      };
      const task = await patchTask(projectId, taskId, patch);

      const repoFullName = String(body.repoFullName || '').trim();
      if (repoFullName) {
        await taskServiceV2.linkGitHub({
          taskId,
          repoFullName,
          branchName: String(patch.branchName || '').trim() || null,
          prState: null,
          prUrl: body.prUrl || null
        });
      }

      return res.json({ ok: true, task: await getTaskByIdCompat(projectId, taskId) || task });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/tasks/:id/link/slack', requireAuth, async (req, res, next) => {
    try {
      const taskId = String(req.params.id || '').trim();
      const body = req.body || {};
      const projectId = String(body.workspaceId || body.workspace_id || body.projectId || body.project_id || '').trim();
      if (!projectId) {
        return res.status(400).json({ error: 'workspaceId is required' });
      }

      const member = await isProjectMember(projectId, req.user.userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a project member' });
      }

      const task = await getTaskByIdCompat(projectId, taskId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const slackTeamId = String(body.slackTeamId || body.slack_team_id || '').trim();
      const slackChannelId = String(body.slackChannelId || body.slack_channel_id || '').trim();
      const slackThreadTs = String(body.slackThreadTs || body.slack_thread_ts || '').trim();
      if (!slackTeamId || !slackChannelId || !slackThreadTs) {
        return res.status(400).json({ error: 'slackTeamId, slackChannelId and slackThreadTs are required' });
      }

      const link = await taskServiceV2.linkSlackThread({
        taskId,
        slackTeamId,
        slackChannelId,
        slackThreadTs,
        slackMessageTs: String(body.slackMessageTs || body.slack_message_ts || '').trim() || null
      });

      return res.json({ ok: true, link, task: await getTaskByIdCompat(projectId, taskId) });
    } catch (error) {
      return next(error);
    }
  });

  // Admin key endpoints (for ops and bootstrapping)
  app.post('/admin/projects', requireAdmin, async (req, res, next) => {
    try {
      const name = String(req.body?.name || '').trim() || 'Untitled Project';
      const project = await createProject(name);

      const ownerLogin = String(req.body?.ownerGithubLogin || '').trim();
      const ownerUserId = String(req.body?.ownerUserId || '').trim();

      let owner = null;
      if (ownerUserId) {
        owner = await getUserById(ownerUserId);
      }
      if (!owner && ownerLogin) {
        owner = await getUserByLogin(ownerLogin);
      }

      if (owner) {
        await addProjectMember(project.id, owner.userId, 'owner');
      }

      return res.json({ ok: true, project });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/admin/projects/:projectId/members', requireAdmin, async (req, res, next) => {
    try {
      const projectId = String(req.params.projectId || '').trim();
      const githubLogin = String(req.body?.githubLogin || '').trim();
      const userId = String(req.body?.userId || '').trim();
      const role = normalizeRole(req.body?.role);

      let user = null;
      if (userId) {
        user = await getUserById(userId);
      }
      if (!user && githubLogin) {
        user = await getUserByLogin(githubLogin);
      }
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const member = await addProjectMember(projectId, user.userId, role);
      return res.json({ ok: true, member });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/admin/projects/:projectId/map/slack-user', requireAdmin, async (req, res, next) => {
    try {
      const projectId = String(req.params.projectId || '').trim();
      const slackUserId = String(req.body?.slackUserId || '').trim();
      const githubLogin = String(req.body?.githubLogin || '').trim();
      const githubUserId = String(req.body?.githubUserId || '').trim();

      if (!slackUserId) {
        return res.status(400).json({ error: 'slackUserId is required' });
      }

      let user = null;
      if (githubUserId) {
        user = await getUserById(githubUserId);
      }
      if (!user && githubLogin) {
        user = await getUserByLogin(githubLogin);
      }
      if (!user) {
        return res.status(404).json({ error: 'GitHub user not found' });
      }

      const mapping = await upsertSlackUserMap(projectId, slackUserId, user);
      await backfillSlackAssigneeMapping(projectId, mapping.slackUserId, user);
      return res.json({ ok: true, mapping });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/admin/projects/:projectId/debug-assignment', requireAdmin, async (req, res, next) => {
    try {
      const projectId = String(req.params.projectId || '').trim();

      const [membersResult, mappingsResult, tasksResult] = await Promise.all([
        query(
          `SELECT pm.project_id, pm.user_id, pm.role, u.login, u.name, u.github_id
           FROM project_members pm
           JOIN users u ON u.id = pm.user_id
           WHERE pm.project_id = $1
           ORDER BY u.login ASC`,
          [projectId]
        ),
        query(
          `SELECT m.project_id, m.slack_user_id, m.github_user_id, u.login, u.name
           FROM slack_user_map m
           JOIN users u ON u.id = m.github_user_id
           WHERE m.project_id = $1
           ORDER BY m.slack_user_id ASC`,
          [projectId]
        ),
        query(
          `SELECT id, title, assignee_id, assigned_to_user_id, pending_slack_assignee, slack_user_id, status, created_at
           FROM tasks
           WHERE project_id = $1
           ORDER BY created_at DESC
           LIMIT 25`,
          [projectId]
        )
      ]);

      return res.json({
        ok: true,
        projectId,
        members: membersResult.rows,
        slackMappings: mappingsResult.rows,
        recentTasks: tasksResult.rows
      });
    } catch (error) {
      return next(error);
    }
  });

  // Authenticated project management endpoints (dashboard)
  app.get('/projects', requireAuth, async (req, res, next) => {
    try {
      const projects = await listProjectsForUser(req.user.userId);
      return res.json({ ok: true, projects });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/projects', requireAuth, async (req, res, next) => {
    try {
      const name = String(req.body?.name || '').trim() || 'Untitled Project';
      const project = await createProject(name);
      await addProjectMember(project.id, req.user.userId, 'owner');
      return res.json({ ok: true, project });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/projects/:projectId/members', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const members = await listProjectMembers(req.projectId);
      return res.json({ ok: true, members });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/projects/:projectId/members', requireAuth, requireProjectMembership, requireProjectOwnerOrAdmin, async (req, res, next) => {
    try {
      const githubLogin = String(req.body?.githubLogin || '').trim();
      const userId = String(req.body?.userId || '').trim();
      const role = normalizeRole(req.body?.role);

      let user = null;
      if (userId) {
        user = await getUserById(userId);
      }
      if (!user && githubLogin) {
        user = await getUserByLogin(githubLogin);
      }
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const member = await addProjectMember(req.projectId, user.userId, role);
      return res.json({ ok: true, member });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/projects/:projectId/onboarding', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const onboarding = await getOnboardingState(req.projectId);
      return res.json({ ok: true, onboarding });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/projects/:projectId/pair-codes', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const pairCode = await createPairCode(req.projectId, req.user.userId, 10);
      return res.status(201).json({
        ok: true,
        pairCode: {
          code: pairCode.code,
          expiresAt: pairCode.expiresAt
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/pair/verify', async (req, res, next) => {
    try {
      const code = String(req.body?.code || '').trim();
      if (!code) {
        return res.status(400).json({ error: 'code is required' });
      }

      let consumedByUserId = null;
      const token = getBearerToken(req);
      if (token) {
        const user = await verifyAuthToken(token);
        if (user) {
          consumedByUserId = user.userId;
        }
      }

      const consumed = await consumePairCode(code, consumedByUserId);
      if (!consumed) {
        return res.status(400).json({ error: 'Invalid or expired pair code' });
      }

      if (consumedByUserId) {
        const alreadyMember = await isProjectMember(consumed.projectId, consumedByUserId);
        if (!alreadyMember) {
          await addProjectMember(consumed.projectId, consumedByUserId, 'member');
        }
      }

      return res.json({
        ok: true,
        apiBaseUrl: appBaseUrl,
        projectId: consumed.projectId,
        baseBranch: 'main'
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/projects/:projectId/invites', requireAuth, requireProjectMembership, requireProjectOwnerOrAdmin, async (req, res, next) => {
    try {
      const invite = await createWorkspaceInvite(req.projectId, req.user.userId, 14);
      return res.status(201).json({
        ok: true,
        invite: {
          token: invite.token,
          joinUrl: `${getDashboardBaseUrl(appBaseUrl)}/join/${invite.token}`
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/invites/:token/accept', requireAuth, async (req, res, next) => {
    try {
      const token = String(req.params.token || '').trim();
      const invite = await getWorkspaceInvite(token);
      if (!invite) {
        return res.status(404).json({ error: 'Invite link is invalid or expired' });
      }

      await addProjectMember(invite.projectId, req.user.userId, 'member');
      return res.json({ ok: true, projectId: invite.projectId });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/projects/:projectId/slack/connect', requireAuth, requireProjectMembership, requireProjectOwnerOrAdmin, async (req, res, next) => {
    try {
      requireEnv('SLACK_CLIENT_ID');
      requireEnv('SLACK_CLIENT_SECRET');

      const state = await createOAuthState('slack_install', `${req.projectId}:${req.user.userId}`);
      const url = new URL('https://slack.com/oauth/v2/authorize');
      url.searchParams.set('client_id', requireEnv('SLACK_CLIENT_ID'));
      url.searchParams.set('scope', 'commands,chat:write,app_mentions:read,channels:history,users:read,im:write');
      url.searchParams.set('redirect_uri', getSlackRedirectUri(appBaseUrl));
      url.searchParams.set('state', state);

      return res.json({ ok: true, url: url.toString() });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/projects/:projectId/slack/status', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const [configResult, mappings] = await Promise.all([
        query(
          `SELECT slack_workspace_id, default_channel_id, last_event_at, created_at
           FROM slack_project_config
           WHERE project_id = $1
           LIMIT 1`,
          [req.projectId]
        ),
        listSlackUserMappings(req.projectId)
      ]);

      const config = configResult.rows[0] || null;
      const lastEventAt = config?.last_event_at || null;
      const requestUrl = `${appBaseUrl}/ingest/slack`;
      const installation = config?.slack_workspace_id
        ? await getSlackInstallationByWorkspaceId(config.slack_workspace_id)
        : null;
      const connectedBy = installation?.installed_by_user_id
        ? await getUserById(String(installation.installed_by_user_id))
        : null;

      return res.json({
        ok: true,
        verified: Boolean(lastEventAt || config?.slack_workspace_id),
        connected: Boolean(config?.slack_workspace_id),
        botInstalled: Boolean(installation?.bot_token || process.env.SLACK_BOT_TOKEN),
        requestUrl,
        lastEventAt,
        slackWorkspaceId: config?.slack_workspace_id || null,
        slackWorkspaceName: installation?.team_name || null,
        defaultChannelId: config?.default_channel_id || null,
        mappedUsersCount: mappings.length,
        connectedBy: connectedBy
          ? {
              userId: connectedBy.userId,
              login: connectedBy.login,
              name: connectedBy.name,
              avatarUrl: connectedBy.avatarUrl
            }
          : null
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/projects/:projectId/slack/users', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const [mappedUsers, seenResult, configResult] = await Promise.all([
        listSlackUserMappings(req.projectId),
        query(
          `SELECT
             COALESCE(NULLIF(pending_slack_assignee, ''), NULLIF(slack_user_id, ''), NULLIF(assignee_id, '')) AS slack_user_id,
             MAX(created_at) AS last_seen_at
           FROM tasks
           WHERE project_id = $1
             AND source = 'slack'
             AND COALESCE(NULLIF(pending_slack_assignee, ''), NULLIF(slack_user_id, ''), NULLIF(assignee_id, '')) IS NOT NULL
           GROUP BY 1
           ORDER BY MAX(created_at) DESC`,
          [req.projectId]
        ),
        query(
          `SELECT slack_workspace_id
           FROM slack_project_config
           WHERE project_id = $1
           LIMIT 1`,
          [req.projectId]
        )
      ]);

      const workspaceId = configResult.rows[0]?.slack_workspace_id || null;
      const mappedWithProfiles = await Promise.all(
        mappedUsers.map(async (entry) => ({
          ...entry,
          slackProfile: await fetchSlackUserProfile(workspaceId, entry.slackUserId)
        }))
      );

      const mappedKeys = new Set(mappedWithProfiles.map((entry) => String(entry.slackUserId || '').toLowerCase()));
      const unmappedUsers = seenResult.rows
        .map((row) => ({
          slackUserId: row.slack_user_id,
          lastSeenAt: row.last_seen_at
        }))
        .filter((entry) => entry.slackUserId && !mappedKeys.has(String(entry.slackUserId).toLowerCase()));

      const unmappedWithProfiles = await Promise.all(
        unmappedUsers.map(async (entry) => ({
          ...entry,
          slackProfile: await fetchSlackUserProfile(workspaceId, entry.slackUserId)
        }))
      );

      return res.json({
        ok: true,
        slackWorkspaceId: workspaceId,
        mappedUsers: mappedWithProfiles,
        unmappedUsers: unmappedWithProfiles
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/projects/:projectId/slack/test-message', requireAuth, requireProjectMembership, requireProjectOwnerOrAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const target = String(body.target || 'default_channel').trim();
      const customChannelId = String(body.channelId || '').trim();

      const configResult = await query(
        `SELECT slack_workspace_id, default_channel_id
         FROM slack_project_config
         WHERE project_id = $1
         LIMIT 1`,
        [req.projectId]
      );
      const config = configResult.rows[0] || null;

      let channelId = '';
      if (target === 'custom_channel') {
        channelId = customChannelId;
      } else if (target === 'my_dm') {
        const mapResult = await query(
          `SELECT slack_user_id
           FROM slack_user_map
           WHERE project_id = $1 AND github_user_id = $2
           LIMIT 1`,
          [req.projectId, req.user.userId]
        );
        channelId = String(mapResult.rows[0]?.slack_user_id || '').trim();
      } else {
        channelId = String(config?.default_channel_id || '').trim() || customChannelId;
      }

      if (!channelId) {
        return res.status(400).json({ error: 'No Slack destination found. Provide a channel id or map your Slack account.' });
      }

      const text = String(body.text || '').trim() ||
        `Relay test message for ${req.projectId} from @${req.user.login} at ${new Date().toLocaleString()}`;

      const warning = await postSlackMessage({
        workspaceId: config?.slack_workspace_id || null,
        channelId,
        text
      });

      if (warning) {
        return res.status(502).json({ error: warning });
      }

      return res.json({
        ok: true,
        target,
        channelId,
        workspaceId: config?.slack_workspace_id || null
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/projects/:projectId/slack/map-user', requireAuth, requireProjectMembership, requireProjectOwnerOrAdmin, async (req, res, next) => {
    try {
      const slackUserId = String(req.body?.slackUserId || '').trim();
      const githubLogin = String(req.body?.githubLogin || '').trim();
      const githubUserId = String(req.body?.githubUserId || '').trim();

      if (!slackUserId) {
        return res.status(400).json({ error: 'slackUserId is required' });
      }

      let user = null;
      if (githubUserId) {
        user = await getUserById(githubUserId);
      }
      if (!user && githubLogin) {
        user = await getUserByLogin(githubLogin);
      }
      if (!user) {
        return res.status(404).json({ error: 'GitHub user not found' });
      }

      const mapping = await upsertSlackUserMap(req.projectId, slackUserId, user);
      await backfillSlackAssigneeMapping(req.projectId, mapping.slackUserId, user);
      return res.json({ ok: true, mapping });
    } catch (error) {
      return next(error);
    }
  });

  async function handleSlackIngest(req, res, fallbackProjectId, overrideText) {
    try {
      if (!verifySlackSignature(req)) {
        return res.status(401).json({ ok: false, error: 'invalid_slack_signature' });
      }

      const body = req.body || {};

      if (body.type === 'url_verification' && body.challenge) {
        return res.status(200).json({ challenge: body.challenge });
      }

      if (body.type === 'event_callback' && body.event && body.event.bot_id) {
        return res.status(200).json({ ok: true, ignored: 'bot_event' });
      }

      const normalizedPayload = normalizeSlackIngestPayload(overrideText ? { ...body, text: overrideText } : body);
      const projectId = await resolveProjectIdFromSlackPayload(normalizedPayload, fallbackProjectId);
      if (!projectId) {
        log('error', 'slack_ingest_unmapped_workspace', {
          requestId: req.requestId,
          teamId: normalizedPayload.team_id || null,
          channelId: normalizedPayload.channel_id || null,
          fallbackProjectId: fallbackProjectId || null
        });
        return res.status(200).json({
          ok: false,
          response_type: 'ephemeral',
          text: 'Relay could not map this Slack workspace/channel to a project. Connect Slack from Relay dashboard first.'
        });
      }

      log('info', 'slack_ingest_routed', {
        requestId: req.requestId,
        teamId: normalizedPayload.team_id || null,
        channelId: normalizedPayload.channel_id || null,
        fallbackProjectId: fallbackProjectId || null,
        resolvedProjectId: projectId
      });

      if (!normalizedPayload.text) {
        await touchSlackProjectEvent(projectId, normalizedPayload.team_id || null, normalizedPayload.channel_id || null);
        return res.status(200).json({ ok: true, ignored: 'no_text' });
      }

      const response = await ingestSlackTask(projectId, normalizedPayload, appBaseUrl);
      if (body.type === 'event_callback') {
        return res.status(200).json({ ok: true, task: response.task });
      }

      return res.status(200).json(response);
    } catch (error) {
      return res.status(200).json({ ok: false, response_type: 'ephemeral', text: String(error?.message || error) });
    }
  }

  app.post('/ingest/slack', async (req, res) => {
    return handleSlackIngest(req, res, null);
  });

  app.post('/ingest/slack/:projectId', async (req, res) => {
    const projectId = String(req.params.projectId || '').trim();
    return handleSlackIngest(req, res, projectId || null);
  });

  app.post('/ingest/slack-nudge/:projectId', async (req, res) => {
    try {
      const parsed = parseNudgeInput(req.body.text || '');
      const fileHint = parsed.filePath ? ` file:${parsed.filePath}` : '';
      const syntheticText = `@${parsed.slackUserId} [task] ${parsed.description}${fileHint}`;
      const projectId = String(req.params.projectId || '').trim();
      return handleSlackIngest(req, res, projectId || null, syntheticText);
    } catch (error) {
      return res.status(200).json({ ok: false, response_type: 'ephemeral', text: String(error?.message || error) });
    }
  });

  app.post('/slack/nudge', async (req, res) => {
    try {
      const parsed = parseNudgeInput(req.body.text || '');
      const fileHint = parsed.filePath ? ` file:${parsed.filePath}` : '';
      const syntheticText = `@${parsed.slackUserId} [task] ${parsed.description}${fileHint}`;
      const queryProjectId = String(req.query.projectId || '').trim() || null;
      return handleSlackIngest(req, res, queryProjectId, syntheticText);
    } catch (error) {
      return res.status(200).json({ ok: false, response_type: 'ephemeral', text: String(error?.message || error) });
    }
  });

  app.post('/webhooks/github', async (req, res, next) => {
    try {
      const signature = verifyGitHubSignature(req);
      if (!signature.ok) {
        if (signature.reason === 'missing_secret') {
          return res.status(503).json({ ok: false, error: 'github_webhook_not_configured' });
        }

        return res.status(401).json({ ok: false, error: 'invalid_github_signature' });
      }

      const event = String(req.headers['x-github-event'] || '').trim().toLowerCase();
      if (event === 'ping') {
        return res.status(200).json({ ok: true, event: 'ping' });
      }

      if (event !== 'pull_request') {
        return res.status(200).json({ ok: true, ignored: event || 'unknown_event' });
      }

      const sync = isTasksDualWriteEnabled()
        ? await syncTaskStatusFromPullRequest(req, req.body || {})
        : { matched: 0, updated: 0, ignored: 'dual_write_disabled' };
      const result = await autoCloseTasksForMergedPullRequest(req, req.body || {});
      return res.status(200).json({ ok: true, event, synced: sync, autoClose: result });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/projects/:projectId/tasks', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const assigned = String(req.query.assigned || 'me').trim().toLowerCase();

      if (assigned === 'all') {
        const tasks = await listTasksCompat(req.projectId, {});
        return res.json({ tasks });
      }

      const tasks = await listTasksCompat(req.projectId, { assignedToUserId: req.user.userId });
      return res.json({ tasks });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/projects/:projectId/tasks', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const body = req.body || {};
      const title = String(body.title || '').trim();
      if (!title) {
        return res.status(400).json({ error: 'title is required' });
      }

      const description = String(body.description || '').trim() || title;
      const priority = String(body.priority || 'normal').trim().toLowerCase() || 'normal';
      const status = String(body.status || 'todo').trim().toLowerCase() || 'todo';

      let assigneeUser = null;
      const assigneeUserId = String(body.assigneeUserId || '').trim();
      const assigneeGithubLogin = String(body.assigneeGithubLogin || '').trim();

      if (assigneeUserId) {
        assigneeUser = await getUserById(assigneeUserId);
      }
      if (!assigneeUser && assigneeGithubLogin) {
        assigneeUser = await getUserByLogin(assigneeGithubLogin);
      }

      const assigneeId = assigneeUser?.login || null;
      const task = await createTask({
        projectId: req.projectId,
        assignee_id: assigneeId,
        assignedToUserId: assigneeUser?.userId || null,
        pendingSlackAssignee: null,
        createdByUserId: req.user.userId,
        updatedByUserId: req.user.userId,
        title,
        description,
        status,
        priority,
        dueDate: body.dueDate || null,
        orderIndex: await nextOrderIndex(req.projectId, assigneeId || 'unassigned'),
        source: 'dashboard',
        sourceUrl: null,
        linkedFiles: Array.isArray(body.linkedFiles) ? body.linkedFiles : [],
        branchName: body.branchName || null,
        prUrl: body.prUrl || null,
        autoCloseOnMerge: Boolean(body.autoCloseOnMerge)
      });

      await safeRecordTaskEvent(req, {
        projectId: req.projectId,
        taskId: task.id,
        actorUserId: req.user.userId,
        actorLabel: req.user.login,
        eventType: 'task.created',
        summary: `Created by @${req.user.login}`,
        metadata: { source: 'dashboard' }
      });

      return res.status(201).json({ ok: true, task });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/projects/:projectId/tasks/:taskId', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const taskId = String(req.params.taskId || '').trim();
      const task = await getTaskByIdCompat(req.projectId, taskId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      return res.json({ task });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/projects/:projectId/tasks/:taskId/events', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const taskId = String(req.params.taskId || '').trim();
      const task = await getTaskByIdCompat(req.projectId, taskId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const limit = Number(req.query.limit || 50);
      const events = await listTaskEvents(req.projectId, taskId, limit);
      return res.json({ ok: true, events });
    } catch (error) {
      return next(error);
    }
  });

  app.patch('/projects/:projectId/tasks/:taskId', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const taskId = String(req.params.taskId || '').trim();
      const before = await getTaskByIdCompat(req.projectId, taskId);
      if (!before) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const body = req.body || {};

      let assignedToUserId = body.assignedToUserId;
      let assigneeId = body.assignee_id;

      if (body.assigneeGithubLogin !== undefined) {
        const login = String(body.assigneeGithubLogin || '').trim();
        if (!login) {
          assignedToUserId = null;
          assigneeId = null;
        } else {
          const user = await getUserByLogin(login);
          if (!user) {
            return res.status(404).json({ error: 'Assignee GitHub user not found' });
          }
          assignedToUserId = user.userId;
          assigneeId = user.login;
        }
      } else if (assignedToUserId !== undefined && assignedToUserId !== null && String(assignedToUserId).trim() !== '') {
        const user = await getUserById(String(assignedToUserId));
        if (!user) {
          return res.status(404).json({ error: 'Assignee user not found' });
        }
        assigneeId = user.login;
      } else if (body.assignedToUserId !== undefined && (assignedToUserId === null || String(assignedToUserId || '').trim() === '')) {
        assignedToUserId = null;
        assigneeId = null;
      }

      const allowed = Object.fromEntries(
        Object.entries({
          assignee_id: assigneeId,
          assignedToUserId,
          autoCloseOnMerge: body.autoCloseOnMerge,
          branchName: body.branchName,
          description: body.description,
          linkedFiles: body.linkedFiles,
          pendingSlackAssignee: body.pendingSlackAssignee,
          prUrl: body.prUrl,
          priority: body.priority,
          status: body.status,
          title: body.title,
          updatedByUserId: req.user.userId
        }).filter(([, value]) => value !== undefined)
      );

      const task = await patchTask(req.projectId, taskId, allowed);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      const responseTask = (await getTaskByIdCompat(req.projectId, taskId)) || task;

      if (isTasksDualWriteEnabled()) {
        const repoFromPatch = String(body.repoFullName || '').trim().toLowerCase();
        const inferredRepo =
          repoFromPatch ||
          extractRepoFullNameFromGitHubUrl(responseTask.prUrl) ||
          extractRepoFullNameFromGitHubUrl(body.prUrl);

        if (inferredRepo && (responseTask.branchName || responseTask.prUrl)) {
          await taskServiceV2.linkGitHub({
            taskId: responseTask.id,
            repoFullName: inferredRepo,
            branchName: responseTask.branchName || null,
            prUrl: responseTask.prUrl || null,
            prState: responseTask.status === 'done' ? 'merged' : responseTask.status === 'review' ? 'open' : null
          });
        }
      }

      let warning;
      if (allowed.status && before.status !== responseTask.status) {
        warning = await postStatusToSlack(responseTask);
        if (warning) {
          log('error', 'slack_status_post_failed', {
            requestId: req.requestId,
            taskId: responseTask.id,
            warning
          });
        }
      }

      const eventsToRecord = [];
      if (before.status !== responseTask.status) {
        eventsToRecord.push({
          eventType: 'task.status_changed',
          summary: `Status changed to ${formatStatus(responseTask.status)}`,
          metadata: {
            before: before.status,
            after: responseTask.status
          }
        });
      }

      if (before.assignedToUserId !== responseTask.assignedToUserId || before.assignee_id !== responseTask.assignee_id) {
        eventsToRecord.push({
          eventType: 'task.assigned',
          summary: responseTask.assignee_id ? `Assigned to @${responseTask.assignee_id}` : 'Unassigned task',
          metadata: {
            beforeAssignedToUserId: before.assignedToUserId || null,
            afterAssignedToUserId: responseTask.assignedToUserId || null,
            beforeAssignee: before.assignee_id || null,
            afterAssignee: responseTask.assignee_id || null
          }
        });
      }

      if (before.title !== responseTask.title || before.description !== responseTask.description) {
        eventsToRecord.push({
          eventType: 'task.updated',
          summary: 'Task details updated',
          metadata: {
            titleChanged: before.title !== responseTask.title,
            descriptionChanged: before.description !== responseTask.description
          }
        });
      }

      for (const event of eventsToRecord) {
        await safeRecordTaskEvent(req, {
          projectId: req.projectId,
          taskId: task.id,
          actorUserId: req.user.userId,
          actorLabel: req.user.login,
          eventType: event.eventType,
          summary: event.summary,
          metadata: event.metadata
        });
      }

      return res.json({ ok: true, task: responseTask, warning: warning || undefined });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/projects/:projectId/tasks/:taskId/commits', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const taskId = String(req.params.taskId || '').trim();
      const body = req.body || {};
      if (!body.sha) {
        return res.status(400).json({ error: 'sha is required' });
      }

      const task = await addCommit(req.projectId, taskId, {
        sha: String(body.sha),
        message: String(body.message || ''),
        author: String(body.author || ''),
        date: String(body.date || new Date().toISOString())
      });

      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      await safeRecordTaskEvent(req, {
        projectId: req.projectId,
        taskId: task.id,
        actorUserId: req.user.userId,
        actorLabel: req.user.login,
        eventType: 'task.commit_linked',
        summary: `Commit linked: ${String(body.sha).slice(0, 7)}`,
        metadata: {
          sha: String(body.sha),
          message: String(body.message || '')
        }
      });

      const responseTask = (await getTaskByIdCompat(req.projectId, taskId)) || task;
      return res.json({ ok: true, task: responseTask });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/projects/:projectId/tasks/:taskId/ai/summarize', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const taskId = String(req.params.taskId || '').trim();
      const task = await summarizeTask(req.projectId, taskId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      return res.json({ ok: true, task });
    } catch (error) {
      return next(error);
    }
  });

  app.use((error, req, res, _next) => {
    log('error', 'request_failed', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      error: String(error?.message || error)
    });

    const status = Number(error?.statusCode || error?.status || 500);
    return res.status(status).json({
      error: String(error?.message || 'Internal Server Error'),
      requestId: req.requestId
    });
  });

  return app;
}

async function start() {
  loadEnv();

  const app = createApp();
  const port = Number(process.env.PORT || 8787);
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      log('info', 'server_listening', { port });
      resolve(undefined);
    });
  });

  void (async () => {
    try {
      await initSchema();
      await cleanupExpiredAuthArtifacts();
      await query(`DELETE FROM slack_account_links WHERE expires_at <= NOW() OR (consumed_at IS NOT NULL AND consumed_at < NOW() - INTERVAL '1 day')`);
      await query(`DELETE FROM workspace_pair_codes WHERE expires_at <= NOW() OR (consumed_at IS NOT NULL AND consumed_at < NOW() - INTERVAL '7 days')`);
      await query(`DELETE FROM workspace_invites WHERE expires_at <= NOW() OR revoked_at IS NOT NULL`);
      runtimeState.startupInitError = null;
      log('info', 'startup_init_ready');
    } catch (error) {
      runtimeState.startupInitError = error;
      log('error', 'startup_init_failed', {
        error: String(error?.message || error),
        stack: String(error?.stack || '')
      });
    }
  })();

  return { app, server };
}

if (require.main === module) {
  void start().catch((error) => {
    log('error', 'startup_failed', {
      error: String(error?.message || error),
      stack: String(error?.stack || '')
    });
    process.exit(1);
  });
}

module.exports = {
  createApp,
  start
};
