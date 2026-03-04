const {
  createTask,
  getTaskById,
  listTasks,
  nextOrderIndex,
  patchTask
} = require('./task-repo');
const {
  getTaskByIdV2,
  getTaskBySlackThread,
  insertTaskEvent,
  listTasksV2,
  upsertGithubLink,
  upsertSlackLink
} = require('./task-repo-v2');

function mapGitHubPrStateToTaskStatus(prState) {
  const normalized = String(prState || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === 'merged') {
    return 'done';
  }

  if (normalized === 'open') {
    return 'in_review';
  }

  if (normalized === 'closed') {
    return 'todo';
  }

  return null;
}

function pickStatusFromGithubLinks(links = []) {
  if (!Array.isArray(links) || links.length === 0) {
    return null;
  }

  if (links.some((link) => String(link.pr_state || '').toLowerCase() === 'merged')) {
    return 'done';
  }

  const ranked = links
    .map((link) => ({
      ...link,
      ts: link.last_synced_at || link.created_at || null
    }))
    .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));

  return mapGitHubPrStateToTaskStatus(ranked[0]?.pr_state || null);
}

async function createTaskV2(input) {
  const orderIndex = input.orderIndex || (await nextOrderIndex(input.projectId, input.assignee_id || 'unassigned'));

  const task = await createTask({
    ...input,
    orderIndex,
    source: input.source || 'api'
  });

  await insertTaskEvent({
    taskId: task.id,
    type: 'created',
    payload: {
      source: task.source,
      title: task.title
    }
  });

  return task;
}

async function linkSlackThread(input) {
  const link = await upsertSlackLink({
    taskId: input.taskId,
    slackTeamId: input.slackTeamId,
    slackChannelId: input.slackChannelId,
    slackThreadTs: input.slackThreadTs,
    slackMessageTs: input.slackMessageTs || null
  });

  await insertTaskEvent({
    taskId: link.task_id,
    type: 'linked_slack',
    payload: {
      slackTeamId: link.slack_team_id,
      slackChannelId: link.slack_channel_id,
      slackThreadTs: link.slack_thread_ts
    }
  });

  return {
    taskId: link.task_id,
    adoptedExisting: link.task_id !== input.taskId,
    link
  };
}

async function linkGitHub(input) {
  const link = await upsertGithubLink({
    taskId: input.taskId,
    provider: input.provider || 'github',
    repoFullName: input.repoFullName,
    repoId: input.repoId || null,
    branchName: input.branchName || null,
    prNumber: input.prNumber || null,
    prUrl: input.prUrl || null,
    prState: input.prState || null
  });

  await insertTaskEvent({
    taskId: input.taskId,
    type: 'linked_github',
    payload: {
      repoFullName: link.repo_full_name,
      branchName: link.branch_name || null,
      prNumber: link.pr_number || null,
      prUrl: link.pr_url || null,
      prState: link.pr_state || null
    }
  });

  return link;
}

async function setStatusFromGitHub(input) {
  const status = mapGitHubPrStateToTaskStatus(input.prState);
  if (!status) {
    return null;
  }

  const before = await getTaskById(input.projectId, input.taskId);
  if (!before) {
    return null;
  }

  const patch = {
    status,
    updatedByUserId: null
  };

  if (input.prUrl) {
    patch.prUrl = input.prUrl;
  }

  const task = await patchTask(input.projectId, input.taskId, patch);
  if (!task) {
    return null;
  }

  if (before.status !== task.status) {
    await insertTaskEvent({
      taskId: task.id,
      type: 'status_changed',
      payload: {
        from: before.status,
        to: task.status,
        reason: 'github_pr_state',
        prState: input.prState
      }
    });
  }

  return task;
}

async function getTasksForUser(input) {
  const options = input.assignedToUserId ? { assignedToUserId: input.assignedToUserId } : {};
  if (input.readV2) {
    return listTasksV2(input.projectId, options);
  }

  return listTasks(input.projectId, options);
}

module.exports = {
  createTask: createTaskV2,
  getTaskByIdV2,
  getTaskBySlackThread,
  getTasksForUser,
  linkGitHub,
  linkSlackThread,
  mapGitHubPrStateToTaskStatus,
  pickStatusFromGithubLinks,
  setStatusFromGitHub
};
