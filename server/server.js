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
  summarizeTask
} = require('./lib/task-repo');
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

function isLikelySlackUserId(value) {
  return /^[UW][A-Z0-9]+$/i.test(String(value || '').trim());
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

function renderAuthSuccessPage() {
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

  const fallbackAssignee = resolveAssignee(parsed.assigneeRef) || parsed.assigneeRef;
  const assigneeId = mapped?.login || fallbackAssignee;
  const assignedToUserId = mapped?.userId || null;

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

  await touchSlackProjectEvent(projectId, payload.team_id || null, payload.channel_id || null);

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
    const explicit = String(fallbackProjectId || '').trim();
    if (explicit) {
      return explicit;
    }

    const workspaceId = String(payload?.team_id || '').trim();
    const channelId = String(payload?.channel_id || '').trim();
    if (!workspaceId) {
      return null;
    }

    return resolveProjectIdForSlack(workspaceId, channelId || null);
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

      await touchSlackProjectEvent(projectId, workspaceId, null);
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
        return res.status(200).send(renderAuthSuccessPage());
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
        return res.status(200).json({
          ok: false,
          response_type: 'ephemeral',
          text: 'Relay could not map this Slack workspace/channel to a project. Connect Slack from Relay dashboard first.'
        });
      }

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
      const syntheticText = `@${parsed.slackUserId} [task] ${parsed.description} file:${parsed.filePath}`;
      const projectId = String(req.params.projectId || '').trim();
      return handleSlackIngest(req, res, projectId || null, syntheticText);
    } catch (error) {
      return res.status(200).json({ ok: false, response_type: 'ephemeral', text: String(error?.message || error) });
    }
  });

  app.post('/slack/nudge', async (req, res) => {
    try {
      const parsed = parseNudgeInput(req.body.text || '');
      const syntheticText = `@${parsed.slackUserId} [task] ${parsed.description} file:${parsed.filePath}`;
      const queryProjectId = String(req.query.projectId || '').trim() || null;
      return handleSlackIngest(req, res, queryProjectId, syntheticText);
    } catch (error) {
      return res.status(200).json({ ok: false, response_type: 'ephemeral', text: String(error?.message || error) });
    }
  });

  app.get('/projects/:projectId/tasks', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const assigned = String(req.query.assigned || 'me').trim().toLowerCase();

      if (assigned === 'all') {
        const tasks = await listTasks(req.projectId, {});
        return res.json({ tasks });
      }

      const tasks = await listTasks(req.projectId, { assignedToUserId: req.user.userId });
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

      return res.status(201).json({ ok: true, task });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/projects/:projectId/tasks/:taskId', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const taskId = String(req.params.taskId || '').trim();
      const task = await getTaskById(req.projectId, taskId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      return res.json({ task });
    } catch (error) {
      return next(error);
    }
  });

  app.patch('/projects/:projectId/tasks/:taskId', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const taskId = String(req.params.taskId || '').trim();
      const before = await getTaskById(req.projectId, taskId);
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
      } else if (assignedToUserId === null || String(assignedToUserId || '').trim() === '') {
        assignedToUserId = null;
        if (body.assignedToUserId !== undefined) {
          assigneeId = null;
        }
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

      let warning;
      if (allowed.status && before.status !== task.status) {
        warning = await postStatusToSlack(task);
        if (warning) {
          log('error', 'slack_status_post_failed', {
            requestId: req.requestId,
            taskId: task.id,
            warning
          });
        }
      }

      return res.json({ ok: true, task, warning: warning || undefined });
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

      return res.json({ ok: true, task });
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
