const { v4: uuidv4 } = require('uuid');
const { query } = require('./db');

function safeJson(value, fallback) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed;
    } catch {
      return fallback;
    }
  }

  return fallback;
}

function normalizeLinkedFiles(value) {
  const arr = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,]/g)
      : [];

  const seen = new Set();
  const out = [];

  for (const file of arr) {
    const cleaned = String(file || '').trim();
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(cleaned);
  }

  return out;
}

function mapTask(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    projectId: row.project_id,
    assignee_id: row.assignee_id,
    assignedToUserId: row.assigned_to_user_id,
    pendingSlackAssignee: row.pending_slack_assignee,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    updatedBy: row.updated_by_login
      ? {
          userId: row.updated_by_user_id,
          login: row.updated_by_login,
          name: row.updated_by_name,
          avatarUrl: row.updated_by_avatar_url
        }
      : null,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    orderIndex: row.order_index,
    source: row.source,
    sourceUrl: row.source_url,
    slackUserId: row.slack_user_id,
    slackChannelId: row.slack_channel_id,
    slackThreadTs: row.slack_thread_ts,
    slackWorkspaceId: row.slack_workspace_id,
    linkedFiles: normalizeLinkedFiles(safeJson(row.linked_files, [])),
    branchName: row.branch_name,
    prUrl: row.pr_url,
    autoCloseOnMerge: Boolean(row.auto_close_on_merge),
    commits: safeJson(row.commits, []),
    ai_title: row.ai_title,
    ai_summary: row.ai_summary,
    ai_acceptance_criteria: safeJson(row.ai_acceptance_criteria, []),
    ai_open_questions: safeJson(row.ai_open_questions, []),
    ai_tags: safeJson(row.ai_tags, []),
    timestamp: row.created_at,
    updatedAt: row.updated_at
  };
}

function taskSelectSql() {
  return `
    SELECT t.*, u.login AS updated_by_login, u.name AS updated_by_name, u.avatar_url AS updated_by_avatar_url
    FROM tasks t
    LEFT JOIN users u ON u.id = t.updated_by_user_id
  `;
}

async function nextOrderIndex(projectId, assigneeId) {
  const result = await query(
    `SELECT COALESCE(MAX(order_index), 0) AS max_order
     FROM tasks
     WHERE project_id = $1 AND assignee_id = $2 AND status != 'done'`,
    [projectId, assigneeId || 'unassigned']
  );

  return Number(result.rows[0]?.max_order || 0) + 1;
}

async function createTask(input) {
  const id = input.id || uuidv4();
  await query(
    `INSERT INTO tasks (
      id, project_id, assignee_id, assigned_to_user_id, pending_slack_assignee,
      created_by_user_id, updated_by_user_id,
      title, description, status, priority, due_date, order_index, source, source_url,
      slack_user_id, slack_channel_id, slack_thread_ts, slack_workspace_id,
      linked_files, branch_name, pr_url, auto_close_on_merge, commits,
      ai_title, ai_summary, ai_acceptance_criteria, ai_open_questions, ai_tags,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7,
      $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19,
      $20::jsonb, $21, $22, $23, $24::jsonb,
      $25, $26, $27::jsonb, $28::jsonb, $29::jsonb,
      NOW(), NOW()
    )`,
    [
      id,
      input.projectId,
      input.assignee_id || null,
      input.assignedToUserId || null,
      input.pendingSlackAssignee || null,
      input.createdByUserId || null,
      input.updatedByUserId || null,
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
      input.slackWorkspaceId || null,
      JSON.stringify(normalizeLinkedFiles(input.linkedFiles || [])),
      input.branchName || null,
      input.prUrl || null,
      Boolean(input.autoCloseOnMerge),
      JSON.stringify(input.commits || []),
      input.ai_title || null,
      input.ai_summary || null,
      JSON.stringify(input.ai_acceptance_criteria || []),
      JSON.stringify(input.ai_open_questions || []),
      JSON.stringify(input.ai_tags || [])
    ]
  );

  if (input.sourceUrl) {
    await query(
      `INSERT INTO task_links (task_id, link_type, url, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [id, 'slack_thread', input.sourceUrl]
    );
  }

  return getTaskById(input.projectId, id);
}

async function getTaskById(projectId, taskId) {
  const result = await query(`${taskSelectSql()} WHERE t.project_id = $1 AND t.id = $2 LIMIT 1`, [projectId, taskId]);
  return mapTask(result.rows[0]);
}

async function listTasks(projectId, options = {}) {
  if (options.assignedToUserId) {
    const result = await query(
      `${taskSelectSql()} WHERE t.project_id = $1 AND t.assigned_to_user_id = $2 ORDER BY t.order_index ASC, t.created_at DESC`,
      [projectId, options.assignedToUserId]
    );
    return result.rows.map(mapTask);
  }

  const result = await query(
    `${taskSelectSql()} WHERE t.project_id = $1 ORDER BY t.order_index ASC, t.created_at DESC`,
    [projectId]
  );

  return result.rows.map(mapTask);
}

async function patchTask(projectId, taskId, patch) {
  const existing = await getTaskById(projectId, taskId);
  if (!existing) {
    return null;
  }

  const next = {
    ...existing,
    ...Object.fromEntries(Object.entries(patch || {}).filter(([, value]) => value !== undefined))
  };

  const linkedFiles = normalizeLinkedFiles(next.linkedFiles || []);
  const commits = safeJson(next.commits, []);
  const aiAcceptance = safeJson(next.ai_acceptance_criteria, []);
  const aiOpenQuestions = safeJson(next.ai_open_questions, []);
  const aiTags = safeJson(next.ai_tags, []);

  await query(
    `UPDATE tasks
     SET assignee_id = $1,
         assigned_to_user_id = $2,
         pending_slack_assignee = $3,
         created_by_user_id = $4,
         updated_by_user_id = $5,
         title = $6,
         description = $7,
         status = $8,
         priority = $9,
         due_date = $10,
         linked_files = $11::jsonb,
         branch_name = $12,
         pr_url = $13,
         auto_close_on_merge = $14,
         commits = $15::jsonb,
         ai_title = $16,
         ai_summary = $17,
         ai_acceptance_criteria = $18::jsonb,
         ai_open_questions = $19::jsonb,
         ai_tags = $20::jsonb,
         updated_at = NOW()
     WHERE id = $21 AND project_id = $22`,
    [
      next.assignee_id || null,
      next.assignedToUserId || null,
      next.pendingSlackAssignee || null,
      next.createdByUserId || null,
      next.updatedByUserId || null,
      next.title,
      next.description,
      next.status,
      next.priority || null,
      next.dueDate || null,
      JSON.stringify(linkedFiles),
      next.branchName || null,
      next.prUrl || null,
      Boolean(next.autoCloseOnMerge),
      JSON.stringify(commits),
      next.ai_title || null,
      next.ai_summary || null,
      JSON.stringify(aiAcceptance),
      JSON.stringify(aiOpenQuestions),
      JSON.stringify(aiTags),
      taskId,
      projectId
    ]
  );

  return getTaskById(projectId, taskId);
}

async function addCommit(projectId, taskId, commit) {
  const task = await getTaskById(projectId, taskId);
  if (!task) {
    return null;
  }

  const current = Array.isArray(task.commits) ? task.commits : [];
  if (current.some((item) => item.sha === commit.sha)) {
    return task;
  }

  const nextCommits = [commit, ...current].slice(0, 100);
  return patchTask(projectId, taskId, { commits: nextCommits });
}

async function backfillSlackAssigneeMapping(projectId, slackUserId, user) {
  if (!projectId || !slackUserId || !user?.userId) {
    return;
  }

  await query(
    `UPDATE tasks
     SET assigned_to_user_id = $1,
         assignee_id = $2,
         pending_slack_assignee = NULL,
         updated_by_user_id = $1,
         updated_at = NOW()
     WHERE project_id = $3 AND (LOWER(COALESCE(pending_slack_assignee,'')) = LOWER($4) OR LOWER(COALESCE(slack_user_id,'')) = LOWER($4))`,
    [user.userId, user.login, projectId, slackUserId]
  );
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

async function summarizeTask(projectId, taskId) {
  const existing = await getTaskById(projectId, taskId);
  if (!existing) {
    return null;
  }

  const ai = localAiSummarize(existing);
  return patchTask(projectId, taskId, ai);
}

module.exports = {
  addCommit,
  backfillSlackAssigneeMapping,
  createTask,
  getTaskById,
  listTasks,
  localAiSummarize,
  nextOrderIndex,
  patchTask,
  summarizeTask
};
