CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  github_id TEXT UNIQUE,
  login TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  assignee_id TEXT,
  assigned_to_user_id TEXT,
  pending_slack_assignee TEXT,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
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
  linked_files TEXT NOT NULL DEFAULT '[]',
  branch_name TEXT,
  pr_url TEXT,
  auto_close_on_merge INTEGER NOT NULL DEFAULT 0,
  commits TEXT NOT NULL DEFAULT '[]',
  ai_title TEXT,
  ai_summary TEXT,
  ai_acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  ai_open_questions TEXT NOT NULL DEFAULT '[]',
  ai_tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(assigned_to_user_id) REFERENCES users(id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id),
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS slack_user_map (
  slack_user_id TEXT PRIMARY KEY,
  github_user_id TEXT,
  github_login TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(github_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  source TEXT,
  login_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS vscode_login_attempts (
  id TEXT PRIMARY KEY,
  session_token TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  consumed_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS task_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  author_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_order
ON tasks (assignee_id, order_index, created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_user
ON tasks (assigned_to_user_id, order_index, created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_status
ON tasks (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_tasks_pending_slack_assignee
ON tasks (pending_slack_assignee);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash
ON sessions (token_hash);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires
ON oauth_states (expires_at);

CREATE INDEX IF NOT EXISTS idx_vscode_login_attempts_expires
ON vscode_login_attempts (expires_at);
