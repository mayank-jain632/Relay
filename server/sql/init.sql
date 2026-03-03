CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  github_id TEXT UNIQUE,
  login TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(project_id, user_id)
);

CREATE TABLE IF NOT EXISTS slack_project_config (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  slack_workspace_id TEXT,
  default_channel_id TEXT,
  last_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS slack_installations (
  slack_workspace_id TEXT PRIMARY KEY,
  enterprise_id TEXT,
  team_name TEXT,
  app_id TEXT,
  access_token TEXT,
  bot_token TEXT,
  bot_user_id TEXT,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  installed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assignee_id TEXT,
  assigned_to_user_id UUID REFERENCES users(id),
  pending_slack_assignee TEXT,
  created_by_user_id UUID REFERENCES users(id),
  updated_by_user_id UUID REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'blocked', 'review', 'done')),
  priority TEXT,
  due_date TEXT,
  order_index INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'slack',
  source_url TEXT,
  slack_user_id TEXT,
  slack_channel_id TEXT,
  slack_thread_ts TEXT,
  slack_workspace_id TEXT,
  linked_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  branch_name TEXT,
  pr_url TEXT,
  auto_close_on_merge BOOLEAN NOT NULL DEFAULT FALSE,
  commits JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_title TEXT,
  ai_summary TEXT,
  ai_acceptance_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_open_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS slack_user_map (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slack_user_id TEXT NOT NULL,
  github_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(project_id, slack_user_id)
);

CREATE TABLE IF NOT EXISTS slack_account_links (
  token TEXT PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slack_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS workspace_pair_codes (
  code TEXT PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  consumed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS workspace_invites (
  token TEXT PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  source TEXT,
  login_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS vscode_login_attempts (
  id TEXT PRIMARY KEY,
  token TEXT,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS task_links (
  id BIGSERIAL PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_comments (
  id BIGSERIAL PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
