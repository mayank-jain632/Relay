const crypto = require('crypto');
const { get, run } = require('./db');
const { getUserById } = require('./user-repo');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const OAUTH_STATE_TTL_MS = 1000 * 60 * 10;
const LOGIN_ATTEMPT_TTL_MS = 1000 * 60 * 10;

function nowIso() {
  return new Date().toISOString();
}

function futureIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createSession(userId) {
  const token = randomToken(32);
  const tokenHash = hashToken(token);
  const createdAt = nowIso();
  const expiresAt = futureIso(SESSION_TTL_MS);

  run(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
    tokenHash,
    userId,
    createdAt,
    expiresAt
  );

  return { token, createdAt, expiresAt };
}

function getUserFromSessionToken(token) {
  if (!token) {
    return null;
  }

  const row = get(
    `SELECT s.user_id
     FROM sessions s
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    hashToken(token),
    nowIso()
  );

  if (!row?.user_id) {
    return null;
  }

  return getUserById(row.user_id);
}

function deleteSession(token) {
  if (!token) {
    return;
  }

  run(`DELETE FROM sessions WHERE token_hash = ?`, hashToken(token));
}

function cleanupExpiredSessions() {
  run(`DELETE FROM sessions WHERE expires_at <= ?`, nowIso());
}

function createOAuthState(source, loginId) {
  const state = randomToken(16);
  run(
    `INSERT INTO oauth_states (state, source, login_id, created_at, expires_at, used_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
    state,
    source || null,
    loginId || null,
    nowIso(),
    futureIso(OAUTH_STATE_TTL_MS)
  );
  return state;
}

function consumeOAuthState(state) {
  const existing = get(`SELECT * FROM oauth_states WHERE state = ?`, state);
  if (!existing) {
    return null;
  }

  if (existing.used_at) {
    return null;
  }

  if (String(existing.expires_at) <= nowIso()) {
    return null;
  }

  run(`UPDATE oauth_states SET used_at = ? WHERE state = ?`, nowIso(), state);
  return existing;
}

function createVscodeLoginAttempt() {
  const id = randomToken(16);
  run(
    `INSERT INTO vscode_login_attempts (id, session_token, user_id, created_at, expires_at, completed_at, consumed_at)
     VALUES (?, NULL, NULL, ?, ?, NULL, NULL)`,
    id,
    nowIso(),
    futureIso(LOGIN_ATTEMPT_TTL_MS)
  );

  return { id };
}

function completeVscodeLoginAttempt(loginId, userId, sessionToken) {
  if (!loginId) {
    return;
  }

  run(
    `UPDATE vscode_login_attempts
     SET user_id = ?, session_token = ?, completed_at = ?
     WHERE id = ? AND expires_at > ?`,
    userId,
    sessionToken,
    nowIso(),
    loginId,
    nowIso()
  );
}

function consumeVscodeLoginAttempt(loginId) {
  if (!loginId) {
    return null;
  }

  const attempt = get(
    `SELECT * FROM vscode_login_attempts WHERE id = ? AND expires_at > ?`,
    loginId,
    nowIso()
  );

  if (!attempt || !attempt.user_id || !attempt.session_token) {
    return null;
  }

  run(`UPDATE vscode_login_attempts SET consumed_at = COALESCE(consumed_at, ?) WHERE id = ?`, nowIso(), loginId);

  return {
    loginId: attempt.id,
    userId: attempt.user_id,
    sessionToken: attempt.session_token,
    completedAt: attempt.completed_at
  };
}

function cleanupExpiredAuthArtifacts() {
  run(`DELETE FROM oauth_states WHERE expires_at <= ?`, nowIso());
  run(`DELETE FROM vscode_login_attempts WHERE expires_at <= ?`, nowIso());
}

module.exports = {
  cleanupExpiredAuthArtifacts,
  cleanupExpiredSessions,
  consumeOAuthState,
  consumeVscodeLoginAttempt,
  createOAuthState,
  createSession,
  createVscodeLoginAttempt,
  deleteSession,
  completeVscodeLoginAttempt,
  getUserFromSessionToken
};
