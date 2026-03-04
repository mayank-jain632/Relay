const crypto = require('crypto');
const { query } = require('./db');

function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function normalizeCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function formatPairCode(raw) {
  const clean = normalizeCode(raw);
  if (clean.length <= 4) {
    return clean;
  }
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

function generatePairCode() {
  return formatPairCode(randomToken(4));
}

async function upsertSlackInstallation(input) {
  const workspaceId = String(input.slackWorkspaceId || '').trim();
  if (!workspaceId) {
    throw new Error('slackWorkspaceId is required');
  }

  await query(
    `INSERT INTO slack_installations (
       slack_workspace_id,
       enterprise_id,
       team_name,
       app_id,
       access_token,
       bot_token,
       bot_user_id,
       project_id,
       installed_by_user_id,
       installed_at,
       updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
     ON CONFLICT(slack_workspace_id)
     DO UPDATE SET
       enterprise_id = EXCLUDED.enterprise_id,
       team_name = EXCLUDED.team_name,
       app_id = EXCLUDED.app_id,
       access_token = EXCLUDED.access_token,
       bot_token = EXCLUDED.bot_token,
       bot_user_id = EXCLUDED.bot_user_id,
       project_id = COALESCE(EXCLUDED.project_id, slack_installations.project_id),
       installed_by_user_id = COALESCE(EXCLUDED.installed_by_user_id, slack_installations.installed_by_user_id),
       updated_at = NOW()`,
    [
      workspaceId,
      input.enterpriseId || null,
      input.teamName || null,
      input.appId || null,
      input.accessToken || null,
      input.botToken || null,
      input.botUserId || null,
      input.projectId || null,
      input.installedByUserId || null
    ]
  );

  const result = await query(
    `SELECT slack_workspace_id, enterprise_id, team_name, app_id, bot_user_id, project_id, installed_by_user_id, installed_at, updated_at
     FROM slack_installations
     WHERE slack_workspace_id = $1
     LIMIT 1`,
    [workspaceId]
  );

  return result.rows[0] || null;
}

async function getSlackInstallationByWorkspaceId(workspaceId) {
  const normalized = String(workspaceId || '').trim();
  if (!normalized) {
    return null;
  }

  const result = await query(
    `SELECT *
     FROM slack_installations
     WHERE slack_workspace_id = $1
     LIMIT 1`,
    [normalized]
  );

  return result.rows[0] || null;
}

async function resolveProjectIdForSlack(workspaceId, channelId) {
  const normalizedWorkspace = String(workspaceId || '').trim();
  const normalizedChannel = String(channelId || '').trim();
  if (!normalizedWorkspace) {
    return null;
  }

  // Authoritative mapping: workspace installation -> project.
  // This avoids stale project_config rows from routing events into the wrong project.
  const installResult = await query(
    `SELECT project_id
     FROM slack_installations
     WHERE slack_workspace_id = $1 AND project_id IS NOT NULL
     LIMIT 1`,
    [normalizedWorkspace]
  );

  if (installResult.rows[0]?.project_id) {
    return String(installResult.rows[0].project_id);
  }

  // Legacy fallback for older records that may not have slack_installations yet.
  const configResult = await query(
    `SELECT project_id
     FROM slack_project_config
     WHERE slack_workspace_id = $1
     ORDER BY CASE WHEN default_channel_id = $2 THEN 0 ELSE 1 END, created_at DESC
     LIMIT 1`,
    [normalizedWorkspace, normalizedChannel || null]
  );

  return configResult.rows[0]?.project_id ? String(configResult.rows[0].project_id) : null;
}

async function touchSlackProjectEvent(projectId, workspaceId, channelId) {
  if (!projectId) {
    return;
  }

  await query(
    `INSERT INTO slack_project_config (project_id, slack_workspace_id, default_channel_id, last_event_at, created_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT(project_id)
     DO UPDATE SET
       -- Keep existing workspace binding during ingest events; only Slack connect should rebind.
       slack_workspace_id = COALESCE(slack_project_config.slack_workspace_id, EXCLUDED.slack_workspace_id),
       default_channel_id = COALESCE(EXCLUDED.default_channel_id, slack_project_config.default_channel_id),
       last_event_at = NOW()`,
    [projectId, workspaceId || null, channelId || null]
  );
}

async function createSlackAccountLink(projectId, slackUserId, ttlMinutes = 60 * 24) {
  const token = randomToken(20);
  await query(
    `INSERT INTO slack_account_links (token, project_id, slack_user_id, created_at, expires_at, consumed_at)
     VALUES ($1, $2, $3, NOW(), NOW() + ($4::text || ' minutes')::interval, NULL)`,
    [token, projectId, slackUserId, String(ttlMinutes)]
  );

  return token;
}

async function consumeSlackAccountLink(token) {
  const normalized = String(token || '').trim();
  if (!normalized) {
    return null;
  }

  const result = await query(
    `SELECT token, project_id, slack_user_id, expires_at, consumed_at
     FROM slack_account_links
     WHERE token = $1
     LIMIT 1`,
    [normalized]
  );

  const row = result.rows[0];
  if (!row || row.consumed_at || new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }

  await query(`UPDATE slack_account_links SET consumed_at = NOW() WHERE token = $1`, [normalized]);
  return {
    token: row.token,
    projectId: row.project_id,
    slackUserId: row.slack_user_id
  };
}

async function createPairCode(projectId, createdByUserId, ttlMinutes = 10) {
  let code = generatePairCode();
  let attempts = 0;

  while (attempts < 8) {
    attempts += 1;
    try {
      await query(
        `INSERT INTO workspace_pair_codes (
           code, project_id, created_by_user_id, consumed_by_user_id, created_at, expires_at, consumed_at
         ) VALUES (
           $1, $2, $3, NULL, NOW(), NOW() + ($4::text || ' minutes')::interval, NULL
         )`,
        [code, projectId, createdByUserId || null, String(ttlMinutes)]
      );

      const result = await query(
        `SELECT code, project_id, expires_at, created_at
         FROM workspace_pair_codes
         WHERE code = $1
         LIMIT 1`,
        [code]
      );

      const row = result.rows[0];
      return {
        code: row.code,
        projectId: row.project_id,
        expiresAt: row.expires_at,
        createdAt: row.created_at
      };
    } catch {
      code = generatePairCode();
    }
  }

  throw new Error('Unable to generate pair code. Retry.');
}

async function consumePairCode(rawCode, consumedByUserId) {
  const code = formatPairCode(rawCode);
  if (!code) {
    return null;
  }

  const result = await query(
    `SELECT code, project_id, expires_at, consumed_at
     FROM workspace_pair_codes
     WHERE code = $1
     LIMIT 1`,
    [code]
  );

  const row = result.rows[0];
  if (!row || row.consumed_at || new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }

  await query(
    `UPDATE workspace_pair_codes
     SET consumed_at = NOW(), consumed_by_user_id = $2
     WHERE code = $1`,
    [code, consumedByUserId || null]
  );

  return {
    code: row.code,
    projectId: row.project_id
  };
}

async function getPairCodeStats(projectId) {
  const result = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE consumed_at IS NOT NULL)::int AS consumed
     FROM workspace_pair_codes
     WHERE project_id = $1`,
    [projectId]
  );

  return {
    total: Number(result.rows[0]?.total || 0),
    consumed: Number(result.rows[0]?.consumed || 0)
  };
}

async function createWorkspaceInvite(projectId, createdByUserId, ttlDays = 14) {
  const token = randomToken(18);
  await query(
    `INSERT INTO workspace_invites (token, project_id, created_by_user_id, created_at, expires_at, revoked_at)
     VALUES ($1, $2, $3, NOW(), NOW() + ($4::text || ' days')::interval, NULL)`,
    [token, projectId, createdByUserId || null, String(ttlDays)]
  );

  return { token, projectId };
}

async function getWorkspaceInvite(token) {
  const normalized = String(token || '').trim();
  if (!normalized) {
    return null;
  }

  const result = await query(
    `SELECT token, project_id, created_at, expires_at, revoked_at
     FROM workspace_invites
     WHERE token = $1
     LIMIT 1`,
    [normalized]
  );

  const row = result.rows[0];
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }

  return {
    token: row.token,
    projectId: row.project_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

async function getOnboardingState(projectId) {
  const [configResult, taskCountResult, pairStats] = await Promise.all([
    query(
      `SELECT slack_workspace_id, default_channel_id, last_event_at
       FROM slack_project_config
       WHERE project_id = $1
       LIMIT 1`,
      [projectId]
    ),
    query(`SELECT COUNT(*)::int AS count FROM tasks WHERE project_id = $1`, [projectId]),
    getPairCodeStats(projectId)
  ]);

  const config = configResult.rows[0] || {};
  const taskCount = Number(taskCountResult.rows[0]?.count || 0);

  return {
    workspaceCreated: true,
    slackConnected: Boolean(config.slack_workspace_id),
    
    extensionLinked: pairStats.consumed > 0,
    firstTaskCreated: taskCount > 0,
    slackWorkspaceId: config.slack_workspace_id || null,
    defaultChannelId: config.default_channel_id || null,
    lastSlackEventAt: config.last_event_at || null,
    pairCodesGenerated: pairStats.total,
    pairCodesConsumed: pairStats.consumed,
    taskCount
  };
}

module.exports = {
  consumePairCode,
  consumeSlackAccountLink,
  createPairCode,
  createSlackAccountLink,
  createWorkspaceInvite,
  getOnboardingState,
  getPairCodeStats,
  getSlackInstallationByWorkspaceId,
  getWorkspaceInvite,
  resolveProjectIdForSlack,
  touchSlackProjectEvent,
  upsertSlackInstallation
};
