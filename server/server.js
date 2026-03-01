const http = require('http');
const express = require('express');
const { initSchema } = require('./lib/db');
const { parseNudgeInput, parseSlackTaskText } = require('./lib/slack-parser');
const { resolveAssignee } = require('./lib/user-map');
const { addCommit, createTask, getTaskById, listTasks, nextOrderIndex, patchTask, summarizeTask } = require('./lib/task-repo');

initSchema();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const httpServer = http.createServer(app);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

function formatStatus(status) {
  return String(status || 'todo').replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildStatusMessage(task) {
  const assignee = task.assignee_id ? `@${task.assignee_id}` : 'assignee';
  const status = String(task.status || 'todo');
  const statusLabel = formatStatus(status);
  const branchPart = task.branchName ? ` (branch: ${task.branchName})` : '';
  const prPart = task.prUrl ? `\nPR: ${task.prUrl}` : '';

  if (status === 'in_progress') {
    return `🟦 ContextHUD: ${assignee} started this task -> ${statusLabel}${branchPart}${prPart}`;
  }

  if (status === 'review') {
    return `🟨 ContextHUD: PR opened -> ${statusLabel}${branchPart}${prPart}`;
  }

  if (status === 'done') {
    return `✅ ContextHUD: Marked ${statusLabel}${branchPart}${prPart}`;
  }

  if (status === 'blocked') {
    return `⛔ ContextHUD: Status updated -> ${statusLabel}${branchPart}${prPart}`;
  }

  return `🔄 ContextHUD: Status updated -> ${statusLabel}${branchPart}${prPart}`;
}

async function postStatusToSlackThread(task) {
  const token = String(process.env.SLACK_BOT_TOKEN || '').trim();
  if (!token) {
    return null;
  }

  if (!task.slackChannelId || !task.slackThreadTs) {
    return null;
  }

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        channel: task.slackChannelId,
        thread_ts: task.slackThreadTs,
        text: buildStatusMessage(task)
      })
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      const reason = payload?.error || `HTTP ${response.status}`;
      console.error('[ContextHUD] Slack post failed:', reason);
      return `Slack status update failed: ${reason}`;
    }

    return null;
  } catch (error) {
    console.error('[ContextHUD] Slack post failed:', error);
    return `Slack status update failed: ${String(error.message || error)}`;
  }
}

function resolveAssigneeForPayload(parsed, payload) {
  const configuredHandle = String(process.env.CONTEXTHUD_USER_HANDLE || '').trim();
  const normalizedToken = normalizeKey(parsed.assigneeRef);
  const normalizedSender = normalizeKey(payload.user_name || payload.user_id);
  const normalizedConfiguredHandle = normalizeKey(configuredHandle);

  let assignee = resolveAssignee(parsed.assigneeRef);

  if (!assignee && normalizedConfiguredHandle && normalizedToken === normalizedConfiguredHandle) {
    assignee = configuredHandle;
  }

  if (!assignee && normalizedToken && normalizedToken === normalizedSender) {
    assignee = resolveAssignee(payload.user_id) || resolveAssignee(payload.user_name);
  }

  return assignee || parsed.assigneeRef;
}

function ingestSlackPayload(payload) {
  const parsed = parseSlackTaskText(payload.text || '');
  const assignee = resolveAssigneeForPayload(parsed, payload);

  const task = createTask({
    assignee_id: assignee,
    description: parsed.description,
    dueDate: parsed.dueDate,
    linkedFiles: parsed.linkedFiles,
    orderIndex: nextOrderIndex(assignee),
    priority: parsed.priority || 'normal',
    slackChannelId: payload.channel_id || null,
    slackThreadTs: payload.thread_ts || null,
    slackUserId: payload.user_id || null,
    source: 'slack',
    sourceUrl: payload.response_url || null,
    status: 'todo',
    title: parsed.title
  });

  return {
    ok: true,
    response_type: 'in_channel',
    task,
    text: `Task created for ${assignee}: ${task.title}`
  };
}

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
    const assigneeQuery = String(req.query.assignee || '').trim();
    const currentUser = String(req.query.currentUser || req.headers['x-current-user'] || '').trim();
    const assignee = assigneeQuery === 'me' ? currentUser : assigneeQuery || undefined;
    const tasks = listTasks(assignee);
    return res.json({ tasks });
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
    const allowed = Object.fromEntries(
      Object.entries({
        autoCloseOnMerge: body.autoCloseOnMerge,
        branchName: body.branchName,
        description: body.description,
        linkedFiles: body.linkedFiles,
        prUrl: body.prUrl,
        priority: body.priority,
        status: body.status,
        title: body.title
      }).filter(([, value]) => value !== undefined)
    );

    const task = patchTask(req.params.id, allowed);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    let warning;
    const statusChanged = Boolean(body.status) && before.status !== task.status;
    if (statusChanged) {
      warning = await postStatusToSlackThread(task);
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
