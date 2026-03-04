function normalizeLinkedFiles(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[\n,]/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function applyV2LinkOverlay(task, links) {
  const next = { ...task };

  if (links?.slack) {
    next.slackWorkspaceId = links.slack.slack_team_id || next.slackWorkspaceId || null;
    next.slackChannelId = links.slack.slack_channel_id || next.slackChannelId || null;
    next.slackThreadTs = links.slack.slack_thread_ts || next.slackThreadTs || null;
  }

  if (links?.github) {
    next.branchName = links.github.branch_name || next.branchName || null;
    next.prUrl = links.github.pr_url || next.prUrl || null;
  }

  next.linkedFiles = normalizeLinkedFiles(next.linkedFiles);
  return next;
}

module.exports = {
  applyV2LinkOverlay,
  normalizeLinkedFiles
};
