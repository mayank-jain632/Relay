CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY,
  assignee_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  description TEXT NOT NULL,
  order_index INTEGER NOT NULL CHECK (order_index > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pm_slack_id TEXT,
  completed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_pending_order
ON tasks (assignee_id, status, order_index);

CREATE INDEX IF NOT EXISTS idx_tasks_status_order
ON tasks (status, order_index);
