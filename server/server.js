const http = require('http');
const express = require('express');
const { initSchema } = require('./lib/db');
const { parseNudgeInput, parseSlackTaskText } = require('./lib/slack-parser');
const { resolveAssignee } = require('./lib/user-map');
const { createTask, getTaskById, listTasks, nextOrderIndex, patchTask, summarizeTask } = require('./lib/task-repo');

initSchema();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const httpServer = http.createServer(app);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

function ingestSlackPayload(payload) {
  const parsed = parseSlackTaskText(payload.text || '');
  let assignee = resolveAssignee(parsed.assigneeRef);

  const normalizedToken = String(parsed.assigneeRef || '').trim().replace(/^@/, '').toLowerCase();
  const normalizedSender = String(payload.user_name || '').trim().replace(/^@/, '').toLowerCase();

  if (!assignee && normalizedToken && normalizedToken === normalizedSender) {
    assignee = resolveAssignee(payload.user_id) || resolveAssignee(payload.user_name);
  }

  if (!assignee) {
    return {
      ok: false,
      response_type: 'ephemeral',
      text: `No local user mapping found for ${parsed.assigneeRef}. Add it in .contexthud/users.json.`
    };
  }

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

app.patch('/tasks/:id', (req, res) => {
  const body = req.body || {};
  const allowed = {
    branchName: body.branchName,
    description: body.description,
    linkedFiles: body.linkedFiles,
    priority: body.priority,
    status: body.status,
    title: body.title
  };

  const task = patchTask(req.params.id, allowed);
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
