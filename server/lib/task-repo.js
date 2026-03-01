const { v4: uuidv4 } = require('uuid');
const { all, get, run } = require('./db');

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function mapTask(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    assignee_id: row.assignee_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    orderIndex: row.order_index,
    source: row.source,
    sourceUrl: row.source_url,
    linkedFiles: safeJsonParse(row.linked_files, []),
    branchName: row.branch_name,
    commits: safeJsonParse(row.commits, []),
    ai_title: row.ai_title,
    ai_summary: row.ai_summary,
    ai_acceptance_criteria: safeJsonParse(row.ai_acceptance_criteria, []),
    ai_open_questions: safeJsonParse(row.ai_open_questions, []),
    ai_tags: safeJsonParse(row.ai_tags, []),
    timestamp: row.created_at,
    updatedAt: row.updated_at
  };
}

function listTasks(assignee) {
  let rows;
  if (assignee) {
    rows = all(`SELECT * FROM tasks WHERE assignee_id = ? ORDER BY order_index ASC, created_at DESC`, assignee);
  } else {
    rows = all(`SELECT * FROM tasks ORDER BY assignee_id ASC, order_index ASC, created_at DESC`);
  }

  return rows.map(mapTask);
}

function getTaskById(id) {
  return mapTask(get(`SELECT * FROM tasks WHERE id = ?`, id));
}

function nextOrderIndex(assigneeId) {
  const row = get(
    `SELECT COALESCE(MAX(order_index), 0) AS max_order FROM tasks WHERE assignee_id = ? AND status != 'done'`,
    assigneeId
  );
  return Number(row?.max_order || 0) + 1;
}

function createTask(input) {
  const now = new Date().toISOString();
  const id = input.id || uuidv4();

  run(
    `INSERT INTO tasks (
      id, assignee_id, title, description, status, priority, due_date, order_index, source, source_url,
      slack_user_id, slack_channel_id, slack_thread_ts, linked_files, branch_name, commits,
      ai_title, ai_summary, ai_acceptance_criteria, ai_open_questions, ai_tags,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.assignee_id,
    input.title,
    input.description,
    input.status || 'todo',
    input.priority || null,
    input.dueDate || null,
    input.orderIndex,
    input.source || 'slack',
    input.sourceUrl || null,
    input.slackUserId || null,
    input.slackChannelId || null,
    input.slackThreadTs || null,
    JSON.stringify(input.linkedFiles || []),
    input.branchName || null,
    JSON.stringify(input.commits || []),
    input.ai_title || null,
    input.ai_summary || null,
    JSON.stringify(input.ai_acceptance_criteria || []),
    JSON.stringify(input.ai_open_questions || []),
    JSON.stringify(input.ai_tags || []),
    now,
    now
  );

  if (input.sourceUrl) {
    run(`INSERT INTO task_links (task_id, link_type, url, created_at) VALUES (?, ?, ?, ?)`, id, 'slack_thread', input.sourceUrl, now);
  }

  return getTaskById(id);
}

function patchTask(id, patch) {
  const existing = getTaskById(id);
  if (!existing) {
    return null;
  }

  const definedPatch = Object.fromEntries(
    Object.entries(patch || {}).filter(([, value]) => value !== undefined)
  );

  const next = {
    ...existing,
    ...definedPatch,
    linkedFiles: definedPatch.linkedFiles ?? existing.linkedFiles,
    commits: definedPatch.commits ?? existing.commits,
    ai_acceptance_criteria: definedPatch.ai_acceptance_criteria ?? existing.ai_acceptance_criteria,
    ai_open_questions: definedPatch.ai_open_questions ?? existing.ai_open_questions,
    ai_tags: definedPatch.ai_tags ?? existing.ai_tags
  };

  run(
    `UPDATE tasks
     SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, linked_files = ?, branch_name = ?, commits = ?,
         ai_title = ?, ai_summary = ?, ai_acceptance_criteria = ?, ai_open_questions = ?, ai_tags = ?, updated_at = ?
     WHERE id = ?`,
    next.title,
    next.description,
    next.status,
    next.priority || null,
    next.dueDate || null,
    JSON.stringify(next.linkedFiles || []),
    next.branchName || null,
    JSON.stringify(next.commits || []),
    next.ai_title || null,
    next.ai_summary || null,
    JSON.stringify(next.ai_acceptance_criteria || []),
    JSON.stringify(next.ai_open_questions || []),
    JSON.stringify(next.ai_tags || []),
    new Date().toISOString(),
    id
  );

  return getTaskById(id);
}

function addCommit(id, commit) {
  const task = getTaskById(id);
  if (!task) {
    return null;
  }

  const existing = task.commits || [];
  if (existing.some((item) => item.sha === commit.sha)) {
    return task;
  }

  const nextCommits = [commit, ...existing].slice(0, 100);
  return patchTask(id, { commits: nextCommits });
}

function localAiSummarize(task) {
  const sentences = String(task.description || '')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

  const summary = sentences.slice(0, 2).join(' ') || task.description;
  const acceptance = [
    `Implement ${task.title} successfully`,
    'Add or update tests for the changed behavior',
    'Verify no regressions in related workflow'
  ];

  const openQuestions = [];
  if (!task.dueDate) {
    openQuestions.push('What is the expected due date?');
  }
  if (!task.linkedFiles?.length) {
    openQuestions.push('Which files should be changed first?');
  }

  const tags = [task.priority || 'normal', task.status, 'slack-ingested'];

  return {
    ai_acceptance_criteria: acceptance,
    ai_open_questions: openQuestions,
    ai_summary: summary,
    ai_tags: tags,
    ai_title: task.title
  };
}

function summarizeTask(id) {
  const existing = getTaskById(id);
  if (!existing) {
    return null;
  }

  const ai = localAiSummarize(existing);
  return patchTask(id, ai);
}

module.exports = {
  addCommit,
  createTask,
  getTaskById,
  listTasks,
  localAiSummarize,
  nextOrderIndex,
  patchTask,
  summarizeTask
};
