const http = require('http');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { initSchema } = require('./lib/db');
const { parseNudgeInput, parseSlackTaskText } = require('./lib/slack-parser');
const { resolveAssignee } = require('./lib/user-map');
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
  cleanupExpiredAuthArtifacts,
  cleanupExpiredSessions,
  consumeOAuthState,
  consumeVscodeLoginAttempt,
  createOAuthState,
  createSession,
  createVscodeLoginAttempt,
  deleteSession,
  completeVscodeLoginAttempt,
  getUserFromSessionToken
} = require('./lib/auth-repo');
const {
  getUserById,
  getUserByLogin,
  resolveMappedUserBySlackId,
  upsertGitHubUser,
  upsertSlackUserMap
} = require('./lib/user-repo');

function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = value;
  }
}

loadDotEnv();
initSchema();
cleanupExpiredSessions();
cleanupExpiredAuthArtifacts();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const origin = String(req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Vscode-Login-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

const httpServer = http.createServer(app);

const appBaseUrl = String(process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 8787}`).replace(/\/$/, '');

function getBearerToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    return undefined;
  }
  return authHeader.slice('Bearer '.length).trim();
}

function getAuthenticatedUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    return null;
  }

  return getUserFromSessionToken(token);
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
      const reason = result?.error || `HTTP ${response.status}`;
      console.error('[ContextHUD] Slack status post failed:', reason);
      return `Slack status update failed: ${reason}`;
    }

    return null;
  } catch (error) {
    console.error('[ContextHUD] Slack status post failed:', error);
    return `Slack status update failed: ${String(error.message || error)}`;
  }
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

function requireGitHubEnv() {
  const missing = [];
  if (!process.env.GITHUB_CLIENT_ID) missing.push('GITHUB_CLIENT_ID');
  if (!process.env.GITHUB_CLIENT_SECRET) missing.push('GITHUB_CLIENT_SECRET');
  if (!process.env.SESSION_SECRET) missing.push('SESSION_SECRET');

  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

async function exchangeGitHubCodeForToken(code) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${appBaseUrl}/auth/github/callback`
    })
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`GitHub token exchange failed: ${data.error || response.status}`);
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

function resolveAssigneeFromSlack(parsed, payload) {
  const legacyAssignee = resolveAssignee(parsed.assigneeRef) || parsed.assigneeRef;

  const mappedUser =
    resolveMappedUserBySlackId(parsed.assigneeRef) ||
    resolveMappedUserBySlackId(payload.user_id) ||
    resolveMappedUserBySlackId(payload.user_name);

  if (mappedUser) {
    return {
      assignedToUserId: mappedUser.userId,
      assigneeId: mappedUser.login,
      pendingSlackAssignee: null
    };
  }

  return {
    assignedToUserId: null,
    assigneeId: legacyAssignee,
    pendingSlackAssignee: parsed.assigneeRef || null
  };
}

function ingestSlackPayload(payload) {
  const parsed = parseSlackTaskText(payload.text || '');
  const assignment = resolveAssigneeFromSlack(parsed, payload);

  const task = createTask({
    assignee_id: assignment.assigneeId,
    assignedToUserId: assignment.assignedToUserId,
    pendingSlackAssignee: assignment.pendingSlackAssignee,
    createdByUserId: null,
    updatedByUserId: null,
    description: parsed.description,
    dueDate: parsed.dueDate,
    linkedFiles: parsed.linkedFiles,
    orderIndex: nextOrderIndex(assignment.assigneeId || parsed.assigneeRef),
    priority: parsed.priority || 'normal',
    slackChannelId: payload.channel_id || null,
    slackThreadTs: payload.thread_ts || null,
    slackUserId: parsed.assigneeRef || null,
    source: 'slack',
    sourceUrl: payload.response_url || null,
    status: 'todo',
    title: parsed.title
  });

  return {
    ok: true,
    response_type: 'in_channel',
    task,
    text: `Task created for ${task.assignee_id || parsed.assigneeRef}: ${task.title}`
  };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/auth/vscode/start', (_req, res) => {
  try {
    requireGitHubEnv();
    const attempt = createVscodeLoginAttempt();
    const loginUrl = `${appBaseUrl}/auth/github/login?source=vscode&loginId=${encodeURIComponent(attempt.id)}`;
    return res.json({ ok: true, loginId: attempt.id, loginUrl });
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
});

app.get('/auth/github/login', (req, res) => {
  try {
    requireGitHubEnv();

    const source = String(req.query.source || '').trim() || null;
    const loginId = String(req.query.loginId || '').trim() || null;
    const state = createOAuthState(source, loginId);
    const redirectUri = `${appBaseUrl}/auth/github/callback`;

    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', String(process.env.GITHUB_CLIENT_ID));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'read:user user:email');
    url.searchParams.set('state', state);

    return res.redirect(url.toString());
  } catch (error) {
    return res.status(500).send(String(error.message || error));
  }
});

app.get('/auth/github/callback', async (req, res) => {
  try {
    requireGitHubEnv();

    const code = String(req.query.code || '').trim();
    const state = String(req.query.state || '').trim();

    if (!code || !state) {
      return res.status(400).send('Missing code or state.');
    }

    const oauthState = consumeOAuthState(state);
    if (!oauthState) {
      return res.status(400).send('Invalid or expired OAuth state.');
    }

    const accessToken = await exchangeGitHubCodeForToken(code);
    const profile = await fetchGitHubProfile(accessToken);
    const user = upsertGitHubUser(profile);
    const session = createSession(user.userId);

    if (oauthState.source === 'vscode' && oauthState.login_id) {
      completeVscodeLoginAttempt(oauthState.login_id, user.userId, session.token);
      return res.status(200).send(renderAuthSuccessPage());
    }

    return res.json({ ok: true, sessionToken: session.token, user });
  } catch (error) {
    console.error('[ContextHUD] OAuth callback failed:', error);
    return res.status(500).send(`OAuth callback failed: ${String(error.message || error)}`);
  }
});

app.post('/auth/logout', (req, res) => {
  const token = getBearerToken(req);
  if (token) {
    deleteSession(token);
  }
  return res.json({ ok: true });
});

app.get('/me', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (user) {
    return res.json(user);
  }

  const loginId = String(req.headers['x-vscode-login-id'] || '').trim();
  if (loginId) {
    const completed = consumeVscodeLoginAttempt(loginId);
    if (!completed) {
      return res.status(401).json({ error: 'Not authenticated yet.' });
    }

    const linkedUser = getUserById(completed.userId);
    if (!linkedUser) {
      return res.status(401).json({ error: 'Authentication failed.' });
    }

    return res.json({ ...linkedUser, sessionToken: completed.sessionToken });
  }

  return res.status(401).json({ error: 'Not authenticated' });
});

app.post('/admin/map/slack-user', (req, res) => {
  try {
    const slackUserId = String(req.body?.slackUserId || '').trim();
    const githubLogin = String(req.body?.githubLogin || '').trim().toLowerCase() || null;
    const githubUserId = String(req.body?.githubUserId || '').trim() || null;

    if (!slackUserId) {
      return res.status(400).json({ error: 'slackUserId is required.' });
    }

    let user = null;
    if (githubUserId) {
      user = getUserById(githubUserId);
    }
    if (!user && githubLogin) {
      user = getUserByLogin(githubLogin);
    }

    if (!user) {
      return res.status(404).json({ error: 'GitHub user not found. Sign in once to create the user record first.' });
    }

    const mapping = upsertSlackUserMap(slackUserId, user);
    backfillSlackAssigneeMapping(slackUserId, user);
    return res.json({ ok: true, mapping });
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
});

app.post('/ingest/slack', (req, res) => {
  try {
    const result = ingestSlackPayload(req.body || {});
    return res.status(200).json(result);
  } catch (error) {
    return res.status(200).json({
      ok: false,
      response_type: 'ephemeral',
      text: error.message
    });
  }
});

app.post('/slack/nudge', (req, res) => {
  try {
    const parsed = parseNudgeInput(req.body.text || '');
    const syntheticPayload = {
      ...req.body,
      text: `@${parsed.slackUserId} [task] ${parsed.description} file:${parsed.filePath}`
    };

    const result = ingestSlackPayload(syntheticPayload);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(200).json({
      ok: false,
      response_type: 'ephemeral',
      text: error.message
    });
  }
});

app.get('/tasks', (req, res) => {
  try {
    const authUser = getAuthenticatedUser(req);
    const assigned = String(req.query.assigned || '').trim().toLowerCase();
    const assigneeQuery = String(req.query.assignee || '').trim();

    if (assigned === 'me') {
      if (!authUser) {
        return res.status(401).json({ error: 'Authentication required for assigned=me' });
      }
      return res.json({ tasks: listTasks({ assignedUserId: authUser.userId }) });
    }

    if (assigned === 'all') {
      return res.json({ tasks: listTasks() });
    }

    if (assigneeQuery) {
      return res.json({ tasks: listTasks({ assignee: assigneeQuery }) });
    }

    if (authUser) {
      return res.json({ tasks: listTasks({ assignedUserId: authUser.userId }) });
    }

    return res.json({ tasks: listTasks() });
  } catch (error) {
    return res.status(500).json({ error: `Failed to load tasks: ${error.message}` });
  }
});

app.get('/tasks/:id', (req, res) => {
  const task = getTaskById(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  return res.json({ task });
});

app.patch('/tasks/:id', async (req, res) => {
  try {
    const before = getTaskById(req.params.id);
    if (!before) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const body = req.body || {};
    const authUser = getAuthenticatedUser(req);

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
        updatedByUserId: authUser?.userId || before.updatedByUserId || null
      }).filter(([, value]) => value !== undefined)
    );

    const task = patchTask(req.params.id, allowed);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    let warning;
    if (allowed.status && before.status !== task.status) {
      warning = await postStatusToSlack(task);
    }

    return res.json({ ok: true, task, warning: warning || undefined });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to patch task: ' + String(error?.message || error) });
  }
});

app.post('/tasks/:id/commits', (req, res) => {
  const body = req.body || {};
  if (!body.sha) {
    return res.status(400).json({ error: 'sha is required' });
  }

  const task = addCommit(req.params.id, {
    sha: String(body.sha),
    message: String(body.message || ''),
    author: String(body.author || ''),
    date: String(body.date || new Date().toISOString())
  });

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  return res.json({ ok: true, task });
});

app.post('/tasks/:id/ai/summarize', (req, res) => {
  const task = summarizeTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  return res.json({ ok: true, task });
});

const port = Number(process.env.PORT || 8787);
httpServer.listen(port, () => {
  console.log(`ContextHUD server listening on ${port}`);
});

module.exports = {
  app
};
