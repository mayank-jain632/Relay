const http = require('http');
const express = require('express');
const { WebClient } = require('@slack/web-api');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const {
  completeTask,
  insertTask,
  listTasks,
  nextOrderIndex,
} = require('./lib/task-repo');
const { parseNudgeInput } = require('./lib/slack-parser');
const { resolveAssignee } = require('./lib/user-map');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*'
  }
});

const slackToken = process.env.SLACK_BOT_TOKEN || '';
const slackClient = slackToken ? new WebClient(slackToken) : undefined;

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/tasks', async (_req, res) => {
  try {
    const tasks = await listTasks();
    res.json({ tasks });
  } catch (error) {
    res.status(500).json({ error: `Failed to load tasks: ${error.message}` });
  }
});

app.post('/tasks/complete', async (req, res) => {
  const taskId = req.body.taskId;
  if (!taskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  const completed = await completeTask(taskId);

  if (!completed) {
    return res.status(404).json({ error: `Task not found: ${taskId}` });
  }

  io.emit('tasksUpdated');
  await notifyPmTaskCompleted(completed).catch((error) => {
    console.error('Failed to DM PM:', error);
  });

  return res.json({ ok: true, task: completed });
});

app.post('/slack/nudge', async (req, res) => {
  try {
    const { slackUserId, filePath, description } = parseNudgeInput(req.body.text);
    const assignee = resolveAssignee(slackUserId);

    if (!assignee) {
      return res.status(400).json({
        response_type: 'ephemeral',
        text: `No local user mapping found for Slack user ${slackUserId}. Add it in .contexthud/users.json (Slack ID U... or @username key).`
      });
    }

    const task = {
      id: uuidv4(),
      assignee_id: assignee,
      filePath,
      description,
      orderIndex: await nextOrderIndex(assignee),
      status: 'pending',
      timestamp: new Date().toISOString(),
      pmSlackId: req.body.user_id || ''
    };

    const created = await insertTask(task);
    io.emit('tasksUpdated');

    return res.json({
      response_type: 'in_channel',
      text: `Nudged ${assignee} (#${created.orderIndex}): ${created.description} (${created.filePath})`
    });
  } catch (error) {
    return res.status(400).json({
      response_type: 'ephemeral',
      text: error.message
    });
  }
});

async function notifyPmTaskCompleted(task) {
  if (!slackClient || !task.pmSlackId) {
    return;
  }

  await slackClient.chat.postMessage({
    channel: task.pmSlackId,
    text: `Task completed by ${task.assignee_id}: ${task.description} (${task.filePath})`
  });
}

const port = Number(process.env.PORT || 8787);
httpServer.listen(port, () => {
  console.log(`ContextHUD server listening on ${port}`);
});

module.exports = {
  app,
  notifyPmTaskCompleted
};
