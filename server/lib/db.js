const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

let pool;

function getDatabaseUrl() {
  const url = String(process.env.DATABASE_URL || '').trim();
  if (!url) {
    throw new Error('DATABASE_URL is required.');
  }
  return url;
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined
    });
  }

  return pool;
}

async function query(text, params = []) {
  return getPool().query(text, params);
}

async function safeQuery(text) {
  try {
    await query(text);
  } catch {
    // best-effort compatibility migration
  }
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function runCompatibilityMigrations() {
  await safeQuery(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id UUID`);
  await safeQuery(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID`);
  await safeQuery(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pending_slack_assignee TEXT`);
  await safeQuery(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by_user_id UUID`);
  await safeQuery(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_by_user_id UUID`);
  await safeQuery(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pr_url TEXT`);
  await safeQuery(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS auto_close_on_merge BOOLEAN NOT NULL DEFAULT FALSE`);
  await safeQuery(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS slack_workspace_id TEXT`);
  await safeQuery(`ALTER TABLE slack_project_config ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ`);

  await safeQuery(`CREATE TABLE IF NOT EXISTS slack_installations (
    slack_workspace_id TEXT PRIMARY KEY,
    enterprise_id TEXT,
    team_name TEXT,
    app_id TEXT,
    access_token TEXT,
    bot_token TEXT,
    bot_user_id TEXT,
    project_id UUID,
    installed_by_user_id UUID,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await safeQuery(`CREATE TABLE IF NOT EXISTS slack_account_links (
    token TEXT PRIMARY KEY,
    project_id UUID NOT NULL,
    slack_user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
  )`);

  await safeQuery(`CREATE TABLE IF NOT EXISTS workspace_pair_codes (
    code TEXT PRIMARY KEY,
    project_id UUID NOT NULL,
    created_by_user_id UUID,
    consumed_by_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
  )`);

  await safeQuery(`CREATE TABLE IF NOT EXISTS task_events (
    id BIGSERIAL PRIMARY KEY,
    project_id UUID NOT NULL,
    task_id UUID NOT NULL,
    actor_user_id UUID,
    actor_label TEXT,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await safeQuery(`CREATE TABLE IF NOT EXISTS workspace_invites (
    token TEXT PRIMARY KEY,
    project_id UUID NOT NULL,
    created_by_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
  )`);

  await safeQuery(`ALTER TABLE slack_user_map ADD COLUMN IF NOT EXISTS project_id UUID`);
  await safeQuery(`ALTER TABLE slack_user_map ADD COLUMN IF NOT EXISTS github_user_id UUID`);
  await safeQuery(`ALTER TABLE slack_user_map ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await safeQuery(`ALTER TABLE slack_user_map ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

  await safeQuery(`CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_user_map_project_slack ON slack_user_map(project_id, slack_user_id)`);

  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_tasks_project_order ON tasks(project_id, order_index, created_at DESC)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_tasks_project_assigned ON tasks(project_id, assigned_to_user_id, order_index)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status, updated_at DESC)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_tasks_project_pending_slack ON tasks(project_id, pending_slack_assignee)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id, project_id)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_vscode_login_attempts_expires ON vscode_login_attempts(expires_at)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_slack_installations_project ON slack_installations(project_id)`);

  // Repair stale project->workspace mappings created before Slack routing hardening.
  await safeQuery(`UPDATE slack_project_config cfg
    SET slack_workspace_id = inst.slack_workspace_id
    FROM slack_installations inst
    WHERE inst.project_id IS NOT NULL
      AND cfg.project_id = inst.project_id
      AND cfg.slack_workspace_id IS DISTINCT FROM inst.slack_workspace_id`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_slack_project_config_workspace ON slack_project_config(slack_workspace_id, default_channel_id)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_workspace_pair_codes_project ON workspace_pair_codes(project_id, consumed_at, expires_at)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_workspace_invites_project ON workspace_invites(project_id, expires_at)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_slack_account_links_project ON slack_account_links(project_id, expires_at)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_task_events_project_task_created ON task_events(project_id, task_id, created_at DESC)`);

}

async function initSchema() {
  const schemaPath = path.join(process.cwd(), 'server', 'sql', 'init.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await query(sql);
  await runCompatibilityMigrations();
}

async function healthCheck() {
  const result = await query('SELECT 1 AS ok');
  return result.rows[0]?.ok === 1;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = {
  closePool,
  getPool,
  healthCheck,
  initSchema,
  query,
  withTransaction
};
