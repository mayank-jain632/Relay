CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  assignee_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
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
  commits TEXT NOT NULL DEFAULT '[]',
  ai_title TEXT,
  ai_summary TEXT,
  ai_acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  ai_open_questions TEXT NOT NULL DEFAULT '[]',
  ai_tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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

CREATE INDEX IF NOT EXISTS idx_tasks_status
ON tasks (status, updated_at);
