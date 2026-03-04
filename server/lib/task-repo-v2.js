const { v4: uuidv4 } = require('uuid');
const { query } = require('./db');
const { getTaskById, listTasks } = require('./task-repo');
const { applyV2LinkOverlay } = require('./task-dto');

async function getTaskBySlackThread(projectId, slackTeamId, slackChannelId, slackThreadTs) {
  if (!projectId || !slackTeamId || !slackChannelId || !slackThreadTs) {
    return null;
  }

  const result = await query(
    `SELECT t.id, t.project_id
       FROM task_links_slack s
       JOIN tasks t ON t.id = s.task_id
      WHERE t.project_id = $1
        AND s.slack_team_id = $2
        AND s.slack_channel_id = $3
        AND s.slack_thread_ts = $4
      LIMIT 1`,
    [projectId, slackTeamId, slackChannelId, slackThreadTs]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return getTaskById(row.project_id, row.id);
}

async function upsertSlackLink(input) {
  const id = input.id || uuidv4();
  const result = await query(
    `INSERT INTO task_links_slack (
       id, task_id, slack_team_id, slack_channel_id, slack_thread_ts, slack_message_ts, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (slack_team_id, slack_channel_id, slack_thread_ts)
     DO UPDATE SET
       slack_message_ts = COALESCE(EXCLUDED.slack_message_ts, task_links_slack.slack_message_ts)
     RETURNING id, task_id, slack_team_id, slack_channel_id, slack_thread_ts, slack_message_ts, created_at`,
    [
      id,
      input.taskId,
      input.slackTeamId,
      input.slackChannelId,
      input.slackThreadTs,
      input.slackMessageTs || null
    ]
  );

  return result.rows[0] || null;
}

async function upsertGithubLink(input) {
  const taskId = String(input.taskId || '').trim();
  const repoFullName = String(input.repoFullName || '').trim().toLowerCase();
  const branchName = String(input.branchName || '').trim() || null;
  const prNumber = Number.isFinite(Number(input.prNumber)) ? Number(input.prNumber) : null;

  if (!taskId || !repoFullName) {
    throw new Error('taskId and repoFullName are required for upsertGithubLink');
  }

  let existing = null;
  if (prNumber !== null) {
    const byPr = await query(
      `SELECT *
         FROM task_links_github
        WHERE task_id = $1 AND LOWER(repo_full_name) = LOWER($2) AND pr_number = $3
        LIMIT 1`,
      [taskId, repoFullName, prNumber]
    );
    existing = byPr.rows[0] || null;
  }

  if (!existing && branchName) {
    const byBranch = await query(
      `SELECT *
         FROM task_links_github
        WHERE task_id = $1 AND LOWER(repo_full_name) = LOWER($2) AND LOWER(branch_name) = LOWER($3)
        LIMIT 1`,
      [taskId, repoFullName, branchName]
    );
    existing = byBranch.rows[0] || null;
  }

  if (!existing && !branchName && prNumber === null && input.prUrl) {
    const byUrl = await query(
      `SELECT *
         FROM task_links_github
        WHERE task_id = $1 AND LOWER(repo_full_name) = LOWER($2) AND LOWER(COALESCE(pr_url, '')) = LOWER($3)
        LIMIT 1`,
      [taskId, repoFullName, String(input.prUrl || '').trim()]
    );
    existing = byUrl.rows[0] || null;
  }

  if (existing) {
    const updated = await query(
      `UPDATE task_links_github
          SET provider = COALESCE($1, provider),
              repo_id = COALESCE($2, repo_id),
              branch_name = COALESCE($3, branch_name),
              pr_number = COALESCE($4, pr_number),
              pr_url = COALESCE($5, pr_url),
              pr_state = COALESCE($6, pr_state),
              last_synced_at = NOW()
        WHERE id = $7
      RETURNING *`,
      [
        input.provider || 'github',
        input.repoId || null,
        branchName,
        prNumber,
        input.prUrl || null,
        input.prState || null,
        existing.id
      ]
    );

    return updated.rows[0] || existing;
  }

  const inserted = await query(
    `INSERT INTO task_links_github (
       id, task_id, provider, repo_full_name, repo_id, branch_name, pr_number, pr_url, pr_state, last_synced_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
     RETURNING *`,
    [
      uuidv4(),
      taskId,
      input.provider || 'github',
      repoFullName,
      input.repoId || null,
      branchName,
      prNumber,
      input.prUrl || null,
      input.prState || null
    ]
  );

  return inserted.rows[0] || null;
}

async function insertTaskEvent(input) {
  const id = input.id || uuidv4();

  await query(
    `INSERT INTO task_events_v2 (id, task_id, type, payload, created_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      input.taskId,
      input.type || 'task.updated',
      JSON.stringify(input.payload || {})
    ]
  );

  return { id, taskId: input.taskId, type: input.type || 'task.updated' };
}

async function readSlackLinksByTaskIds(taskIds) {
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return new Map();
  }

  const result = await query(
    `SELECT DISTINCT ON (task_id)
            task_id, slack_team_id, slack_channel_id, slack_thread_ts, slack_message_ts, created_at
       FROM task_links_slack
      WHERE task_id = ANY($1::uuid[])
      ORDER BY task_id, created_at DESC`,
    [taskIds]
  );

  const map = new Map();
  for (const row of result.rows) {
    map.set(row.task_id, row);
  }

  return map;
}

async function readGithubLinksByTaskIds(taskIds) {
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return new Map();
  }

  const result = await query(
    `SELECT DISTINCT ON (task_id)
            task_id, provider, repo_full_name, repo_id, branch_name, pr_number, pr_url, pr_state, last_synced_at, created_at
       FROM task_links_github
      WHERE task_id = ANY($1::uuid[])
      ORDER BY task_id, last_synced_at DESC NULLS LAST, created_at DESC`,
    [taskIds]
  );

  const map = new Map();
  for (const row of result.rows) {
    map.set(row.task_id, row);
  }

  return map;
}

async function listTasksV2(projectId, options = {}) {
  const tasks = await listTasks(projectId, options);
  const ids = tasks.map((task) => task.id);

  const [slackLinks, githubLinks] = await Promise.all([
    readSlackLinksByTaskIds(ids),
    readGithubLinksByTaskIds(ids)
  ]);

  return tasks.map((task) =>
    applyV2LinkOverlay(task, {
      slack: slackLinks.get(task.id) || null,
      github: githubLinks.get(task.id) || null
    })
  );
}

async function getTaskByIdV2(projectId, taskId) {
  const task = await getTaskById(projectId, taskId);
  if (!task) {
    return null;
  }

  const [slackLinks, githubLinks] = await Promise.all([
    readSlackLinksByTaskIds([task.id]),
    readGithubLinksByTaskIds([task.id])
  ]);

  return applyV2LinkOverlay(task, {
    slack: slackLinks.get(task.id) || null,
    github: githubLinks.get(task.id) || null
  });
}

module.exports = {
  getTaskByIdV2,
  getTaskBySlackThread,
  insertTaskEvent,
  listTasksV2,
  upsertGithubLink,
  upsertSlackLink
};
