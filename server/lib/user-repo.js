const { v4: uuidv4 } = require('uuid');
const { query } = require('./db');

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
  await query(`INSERT INTO projects (id, name, created_at) VALUES ($1, $2, NOW())`, [projectId, String(name || '').trim() || 'Untitled']);
  return { id: projectId, name: String(name || '').trim() || 'Untitled' };
}

async function addProjectMember(projectId, userId, role = 'member') {
  await query(
    `INSERT INTO project_members (project_id, user_id, role, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT(project_id, user_id)
     DO UPDATE SET role = EXCLUDED.role`,
    [projectId, userId, role]
  );

  return { projectId, userId, role };
}

async function isProjectMember(projectId, userId) {
  const result = await query(
    `SELECT 1 AS ok FROM project_members WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
    [projectId, userId]
  );

  return result.rowCount > 0;
}

async function resolveMappedUserBySlackId(projectId, slackUserId) {
  const normalizedProjectId = String(projectId || '').trim();
  const normalizedSlackId = String(slackUserId || '').trim();
  if (!normalizedProjectId || !normalizedSlackId) {
    return null;
  }

  const result = await query(
    `SELECT u.*
     FROM slack_user_map m
     JOIN users u ON u.id = m.github_user_id
     WHERE m.project_id = $1 AND m.slack_user_id = $2
     LIMIT 1`,
    [normalizedProjectId, normalizedSlackId]
  );

  return mapUser(result.rows[0]);
}

async function upsertSlackUserMap(projectId, slackUserId, user) {
  const normalizedProjectId = String(projectId || '').trim();
  const normalizedSlackId = String(slackUserId || '').trim();
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

module.exports = {
  addProjectMember,
  createProject,
  getUserByGithubId,
  getUserById,
  getUserByLogin,
  isProjectMember,
  resolveMappedUserBySlackId,
  upsertGitHubUser,
  upsertSlackUserMap
};
