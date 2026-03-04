CREATE TABLE IF NOT EXISTS relay_workspaces (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO relay_workspaces (id, name, owner_user_id, created_at, updated_at)
SELECT p.id,
       p.name,
       (
         SELECT pm.user_id
         FROM project_members pm
         WHERE pm.project_id = p.id
         ORDER BY CASE WHEN LOWER(pm.role) = 'owner' THEN 0 ELSE 1 END, pm.created_at ASC
         LIMIT 1
       ) AS owner_user_id,
       p.created_at,
       NOW()
FROM projects p
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    updated_at = NOW();

CREATE INDEX IF NOT EXISTS idx_relay_workspaces_owner ON relay_workspaces(owner_user_id);
