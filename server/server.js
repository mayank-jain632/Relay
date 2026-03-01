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
  getUserById,
  getUserByLogin,
  isProjectMember,
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

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
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
    return `🟦 ContextHUD: ${assignee} started this task -> ${statusLabel}${branchPart}`;
  }

  if (task.status === 'review') {
    return `🟨 ContextHUD: PR opened -> ${statusLabel}${branchPart}${prPart}`;
  }

  if (task.status === 'done') {
    return `✅ ContextHUD: Marked ${statusLabel}${branchPart}`;
  }

  if (task.status === 'blocked') {
    return `⛔ ContextHUD: Status updated -> ${statusLabel}${branchPart}`;
  }

  return `🔄 ContextHUD: Status updated -> ${statusLabel}${branchPart}`;
}

async function postStatusToSlack(task) {
  const token = String(process.env.SLACK_BOT_TOKEN || '').trim();
  if (!token || !task.slackChannelId) {
    return null;
  }

  const payload = {
    channel: task.slackChannelId,
    text: buildStatusMessage(task)
  };

  if (task.slackThreadTs) {
    payload.thread_ts = task.slackThreadTs;
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
      return `Slack status update failed: ${result?.error || `HTTP ${response.status}`}`;
    }

    return null;
  } catch (error) {
    return `Slack status update failed: ${String(error?.message || error)}`;
  }
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
      <p>You can close this tab and return to VS Code.</p>
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
      'User-Agent': 'relay-contexthud',
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
        'User-Agent': 'relay-contexthud',
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

async function ingestSlackTask(projectId, payload) {
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

  await query(
    `INSERT INTO slack_project_config (project_id, slack_workspace_id, default_channel_id, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT(project_id)
     DO UPDATE SET
       slack_workspace_id = COALESCE(EXCLUDED.slack_workspace_id, slack_project_config.slack_workspace_id),
       default_channel_id = COALESCE(EXCLUDED.default_channel_id, slack_project_config.default_channel_id)`,
    [projectId, payload.team_id || null, payload.channel_id || null]
  );

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
      const projectId = String(req.params.projectId || '').trim();
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }

      const member = await isProjectMember(projectId, req.user.userId);
      if (!member) {
        return res.status(403).json({ error: 'Not a project member' });
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  function requireAdmin(req, res, next) {
    const expected = String(process.env.ADMIN_API_KEY || '').trim();
    const actual = String(req.headers['x-admin-api-key'] || '').trim();
    if (!expected || !actual || expected !== actual) {
      return res.status(401).json({ error: 'Invalid admin key' });
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

  app.post('/auth/vscode/start', async (_req, res, next) => {
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
  });

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
      const role = String(req.body?.role || 'member').trim();

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
      await backfillSlackAssigneeMapping(projectId, slackUserId, user);
      return res.json({ ok: true, mapping });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/ingest/slack/:projectId', async (req, res, next) => {
    try {
      if (!verifySlackSignature(req)) {
        return res.status(401).json({ ok: false, error: 'invalid_slack_signature' });
      }

      const projectId = String(req.params.projectId || '').trim();
      const body = req.body || {};

      // Slack Event Subscriptions URL verification handshake.
      if (body.type === 'url_verification' && body.challenge) {
        return res.status(200).json({ challenge: body.challenge });
      }

      // Ignore bot-originated events to avoid loops.
      if (body.type === 'event_callback' && body.event && body.event.bot_id) {
        return res.status(200).json({ ok: true, ignored: 'bot_event' });
      }

      const normalizedPayload = normalizeSlackIngestPayload(body);
      if (!normalizedPayload.text) {
        return res.status(200).json({ ok: true, ignored: 'no_text' });
      }

      const response = await ingestSlackTask(projectId, normalizedPayload);
      if (body.type === 'event_callback') {
        return res.status(200).json({ ok: true, task: response.task });
      }

      return res.status(200).json(response);
    } catch (error) {
      return res.status(200).json({ ok: false, response_type: 'ephemeral', text: String(error?.message || error) });
    }
  });

  app.post('/ingest/slack-nudge/:projectId', async (req, res, next) => {
    try {
      if (!verifySlackSignature(req)) {
        return res.status(401).json({ ok: false, error: 'invalid_slack_signature' });
      }

      const projectId = String(req.params.projectId || '').trim();
      const parsed = parseNudgeInput(req.body.text || '');
      const syntheticPayload = {
        ...req.body,
        text: `@${parsed.slackUserId} [task] ${parsed.description} file:${parsed.filePath}`
      };

      const response = await ingestSlackTask(projectId, syntheticPayload);
      return res.status(200).json(response);
    } catch (error) {
      return res.status(200).json({ ok: false, response_type: 'ephemeral', text: String(error?.message || error) });
    }
  });

  app.post('/slack/nudge', async (req, res) => {
    const projectId = String(req.query.projectId || '').trim();
    if (!projectId) {
      return res.status(400).json({ ok: false, error: 'projectId query param is required' });
    }

    try {
      const parsed = parseNudgeInput(req.body.text || '');
      const syntheticPayload = {
        ...req.body,
        text: `@${parsed.slackUserId} [task] ${parsed.description} file:${parsed.filePath}`
      };

      const response = await ingestSlackTask(projectId, syntheticPayload);
      return res.status(200).json(response);
    } catch (error) {
      return res.status(200).json({ ok: false, response_type: 'ephemeral', text: String(error?.message || error) });
    }
  });

  app.get('/projects/:projectId/tasks', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const projectId = String(req.params.projectId || '').trim();
      const assigned = String(req.query.assigned || 'me').trim().toLowerCase();

      if (assigned === 'all') {
        const tasks = await listTasks(projectId, {});
        return res.json({ tasks });
      }

      const tasks = await listTasks(projectId, { assignedToUserId: req.user.userId });
      return res.json({ tasks });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/projects/:projectId/tasks/:taskId', requireAuth, requireProjectMembership, async (req, res, next) => {
    try {
      const projectId = String(req.params.projectId || '').trim();
      const taskId = String(req.params.taskId || '').trim();
      const task = await getTaskById(projectId, taskId);
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
      const projectId = String(req.params.projectId || '').trim();
      const taskId = String(req.params.taskId || '').trim();
      const before = await getTaskById(projectId, taskId);
      if (!before) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const body = req.body || {};
      const allowed = Object.fromEntries(
        Object.entries({
          assignee_id: body.assignee_id,
          assignedToUserId: body.assignedToUserId,
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

      const task = await patchTask(projectId, taskId, allowed);
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
      const projectId = String(req.params.projectId || '').trim();
      const taskId = String(req.params.taskId || '').trim();
      const body = req.body || {};
      if (!body.sha) {
        return res.status(400).json({ error: 'sha is required' });
      }

      const task = await addCommit(projectId, taskId, {
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
      const projectId = String(req.params.projectId || '').trim();
      const taskId = String(req.params.taskId || '').trim();
      const task = await summarizeTask(projectId, taskId);
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
