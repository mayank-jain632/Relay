const { v4: uuidv4 } = require('uuid');
const { get, run } = require('./db');

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

function getUserById(id) {
  return mapUser(get('SELECT * FROM users WHERE id = ?', id));
}

function getUserByLogin(login) {
  return mapUser(get('SELECT * FROM users WHERE login = ?', String(login || '').toLowerCase()));
}

function getUserByGithubId(githubId) {
  return mapUser(get('SELECT * FROM users WHERE github_id = ?', String(githubId || '')));
}

function upsertGitHubUser(profile) {
  const now = new Date().toISOString();
  const githubId = String(profile.id || '');
  const login = String(profile.login || '').trim().toLowerCase();

  if (!githubId || !login) {
    throw new Error('Invalid GitHub profile payload.');
  }

  const existingByGithubId = getUserByGithubId(githubId);
  if (existingByGithubId) {
    run(
      `UPDATE users SET login = ?, name = ?, avatar_url = ?, email = ?, updated_at = ? WHERE id = ?`,
      login,
      profile.name || null,
      profile.avatar_url || null,
      profile.email || null,
      now,
      existingByGithubId.userId
    );
    return getUserById(existingByGithubId.userId);
  }

  const existingByLogin = getUserByLogin(login);
  if (existingByLogin) {
    run(
      `UPDATE users SET github_id = ?, name = ?, avatar_url = ?, email = ?, updated_at = ? WHERE id = ?`,
      githubId,
      profile.name || null,
      profile.avatar_url || null,
      profile.email || null,
      now,
      existingByLogin.userId
    );
    return getUserById(existingByLogin.userId);
  }

  const id = uuidv4();
  run(
    `INSERT INTO users (id, github_id, login, name, avatar_url, email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    githubId,
    login,
    profile.name || null,
    profile.avatar_url || null,
    profile.email || null,
    now,
    now
  );

  return getUserById(id);
}

function resolveMappedUserBySlackId(slackUserId) {
  const key = String(slackUserId || '').trim();
  if (!key) {
    return null;
  }

  const row = get(
    `SELECT u.*
     FROM slack_user_map m
     JOIN users u ON u.id = m.github_user_id
     WHERE m.slack_user_id = ?`,
    key
  );

  return mapUser(row);
}

function upsertSlackUserMap(slackUserId, user) {
  const now = new Date().toISOString();
  const key = String(slackUserId || '').trim();
  if (!key) {
    throw new Error('slackUserId is required.');
  }

  if (!user?.userId || !user?.login) {
    throw new Error('Valid GitHub user is required.');
  }

  run(
    `INSERT INTO slack_user_map (slack_user_id, github_user_id, github_login, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(slack_user_id)
     DO UPDATE SET github_user_id = excluded.github_user_id, github_login = excluded.github_login, updated_at = excluded.updated_at`,
    key,
    user.userId,
    user.login,
    now,
    now
  );

  return { slackUserId: key, githubUserId: user.userId, githubLogin: user.login };
}

module.exports = {
  getUserById,
  getUserByGithubId,
  getUserByLogin,
  resolveMappedUserBySlackId,
  upsertGitHubUser,
  upsertSlackUserMap
};
