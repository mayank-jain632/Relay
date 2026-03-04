CREATE TABLE IF NOT EXISTS task_links_slack (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  slack_team_id TEXT NOT NULL,
  slack_channel_id TEXT NOT NULL,
  slack_thread_ts TEXT NOT NULL,
  slack_message_ts TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_links_slack_thread
  ON task_links_slack(slack_team_id, slack_channel_id, slack_thread_ts);

CREATE INDEX IF NOT EXISTS idx_task_links_slack_task_id
  ON task_links_slack(task_id);

CREATE TABLE IF NOT EXISTS task_links_github (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'github',
  repo_full_name TEXT NOT NULL,
  repo_id TEXT,
  branch_name TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  pr_state TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_links_github_task_id
  ON task_links_github(task_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_links_github_task_repo_branch
  ON task_links_github(task_id, repo_full_name, branch_name)
  WHERE branch_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_links_github_task_repo_pr
  ON task_links_github(task_id, repo_full_name, pr_number)
  WHERE pr_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_events_v2 (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_events_v2_task_id_created
  ON task_events_v2(task_id, created_at DESC);
