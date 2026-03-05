const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('./db');

function normalizeSlackIdentifier(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const mention = raw.match(/^<@([A-Z0-9]+)(?:\|[^>]+)?>$/i);
  const withoutPrefix = mention ? mention[1] : raw.replace(/^@+/, '');
  if (!withoutPrefix) {
    return '';
  }

  if (/^[UW][A-Z0-9]+$/i.test(withoutPrefix)) {
    return withoutPrefix.toUpperCase();
  }

  return withoutPrefix.toLowerCase();
}

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    userId: row.id,
    githubId: row.github_id,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatar_url,
    email: row.email
  };
}

async function getUserById(id) {
  const result = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return mapUser(result.rows[0]);
}

async function getUserByLogin(login) {
  const normalized = String(login || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const result = await query('SELECT * FROM users WHERE login = $1 LIMIT 1', [normalized]);
  return mapUser(result.rows[0]);
}

async function getUserByGithubId(githubId) {
  const normalized = String(githubId || '').trim();
  if (!normalized) {
    return null;
  }

  const result = await query('SELECT * FROM users WHERE github_id = $1 LIMIT 1', [normalized]);
  return mapUser(result.rows[0]);
}

async function upsertGitHubUser(profile) {
  const githubId = String(profile.id || '').trim();
  const login = String(profile.login || '').trim().toLowerCase();

  if (!githubId || !login) {
    throw new Error('Invalid GitHub profile payload.');
  }

  const existingByGithubId = await getUserByGithubId(githubId);
  if (existingByGithubId) {
    await query(
      `UPDATE users
       SET login = $1, name = $2, avatar_url = $3, email = $4, updated_at = NOW()
       WHERE id = $5`,
      [login, profile.name || null, profile.avatar_url || null, profile.email || null, existingByGithubId.userId]
    );

    return getUserById(existingByGithubId.userId);
  }

  const existingByLogin = await getUserByLogin(login);
  if (existingByLogin) {
    await query(
      `UPDATE users
       SET github_id = $1, name = $2, avatar_url = $3, email = $4, updated_at = NOW()
       WHERE id = $5`,
      [githubId, profile.name || null, profile.avatar_url || null, profile.email || null, existingByLogin.userId]
    );

    return getUserById(existingByLogin.userId);
  }

  const id = uuidv4();
  await query(
    `INSERT INTO users (id, github_id, login, name, avatar_url, email, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [id, githubId, login, profile.name || null, profile.avatar_url || null, profile.email || null]
  );

  return getUserById(id);
}

async function createProject(name) {
  const projectId = uuidv4();
  const projectName = String(name || '').trim() || 'Untitled';
  await query(`INSERT INTO projects (id, name, created_at) VALUES ($1, $2, NOW())`, [projectId, projectName]);
  await query(
    `INSERT INTO relay_workspaces (id, name, owner_user_id, created_at, updated_at)
     VALUES ($1, $2, NULL, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
    [projectId, projectName]
  );
  return { id: projectId, name: projectName };
}

async function addProjectMember(projectId, userId, role = 'member') {
  await query(
    `INSERT INTO project_members (project_id, user_id, role, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT(project_id, user_id)
     DO UPDATE SET role = EXCLUDED.role`,
    [projectId, userId, role]
  );

  if (String(role || '').toLowerCase() === 'owner') {
    await query(
      `INSERT INTO relay_workspaces (id, name, owner_user_id, created_at, updated_at)
       SELECT p.id, p.name, $2, NOW(), NOW()
       FROM projects p
       WHERE p.id = $1
       ON CONFLICT (id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id, updated_at = NOW()`,
      [projectId, userId]
    );
  }

  return { projectId, userId, role };
}

async function isProjectMember(projectId, userId) {
  const result = await query(
    `SELECT 1 AS ok FROM project_members WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
    [projectId, userId]
  );

  return result.rowCount > 0;
}

async function getProjectMembership(projectId, userId) {
  const result = await query(
    `SELECT project_id, user_id, role
     FROM project_members
     WHERE project_id = $1 AND user_id = $2
     LIMIT 1`,
    [projectId, userId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    projectId: row.project_id,
    userId: row.user_id,
    role: row.role
  };
}

async function listProjectsForUser(userId) {
  const result = await query(
    `SELECT p.id, p.name, p.created_at, pm.role
     FROM project_members pm
     JOIN projects p ON p.id = pm.project_id
     WHERE pm.user_id = $1
     ORDER BY p.created_at DESC`,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    createdAt: row.created_at
  }));
}

async function listProjectMembers(projectId) {
  const result = await query(
    `SELECT pm.project_id, pm.user_id, pm.role, u.login, u.name, u.avatar_url
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = $1
     ORDER BY u.login ASC`,
    [projectId]
  );

  return result.rows.map((row) => ({
    projectId: row.project_id,
    userId: row.user_id,
    role: row.role,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatar_url
  }));
}

async function listSlackUserMappings(projectId) {
  const result = await query(
    `SELECT m.project_id, m.slack_user_id, m.github_user_id, u.login, u.name, u.avatar_url
     FROM slack_user_map m
     JOIN users u ON u.id = m.github_user_id
     WHERE m.project_id = $1
     ORDER BY m.slack_user_id ASC`,
    [projectId]
  );

  return result.rows.map((row) => ({
    projectId: row.project_id,
    slackUserId: row.slack_user_id,
    githubUserId: row.github_user_id,
    githubLogin: row.login,
    githubName: row.name,
    avatarUrl: row.avatar_url
  }));
}

async function resolveMappedUserBySlackId(projectId, slackUserId) {
  const normalizedProjectId = String(projectId || '').trim();
  const normalizedSlackId = normalizeSlackIdentifier(slackUserId);
  if (!normalizedProjectId || !normalizedSlackId) {
    return null;
  }

  const result = await query(
    `SELECT u.*
     FROM slack_user_map m
     JOIN users u ON u.id = m.github_user_id
     WHERE m.project_id = $1 AND LOWER(m.slack_user_id) = LOWER($2)
     LIMIT 1`,
    [normalizedProjectId, normalizedSlackId]
  );

  return mapUser(result.rows[0]);
}

async function upsertSlackUserMap(projectId, slackUserId, user) {
  const normalizedProjectId = String(projectId || '').trim();
  const normalizedSlackId = normalizeSlackIdentifier(slackUserId);
  if (!normalizedProjectId || !normalizedSlackId) {
    throw new Error('projectId and slackUserId are required.');
  }

  if (!user?.userId) {
    throw new Error('Valid GitHub user is required.');
  }

  await query(
    `INSERT INTO slack_user_map (project_id, slack_user_id, github_user_id, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT(project_id, slack_user_id)
     DO UPDATE SET github_user_id = EXCLUDED.github_user_id, updated_at = NOW()`,
    [normalizedProjectId, normalizedSlackId, user.userId]
  );

  return {
    projectId: normalizedProjectId,
    slackUserId: normalizedSlackId,
    githubUserId: user.userId,
    githubLogin: user.login
  };
}

async function deleteProject(projectId) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) {
    return null;
  }

  return withTransaction(async (client) => {
    const result = await client.query(
      'DELETE FROM projects WHERE id = $1 RETURNING id, name, created_at',
      [normalizedProjectId]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at
    };
  });
}

module.exports = {
  addProjectMember,
  createProject,
  deleteProject,
  getProjectMembership,
  getUserByGithubId,
  getUserById,
  getUserByLogin,
  isProjectMember,
  listProjectMembers,
  listProjectsForUser,
  listSlackUserMappings,
  resolveMappedUserBySlackId,
  upsertGitHubUser,
  upsertSlackUserMap
};
