const crypto = require('crypto');
const { query } = require('./db');
const { getUserById } = require('./user-repo');

const OAUTH_STATE_TTL_MS = 1000 * 60 * 10;
const LOGIN_ATTEMPT_TTL_MS = 1000 * 60 * 10;
const AUTH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function getSessionSecret() {
  const secret = String(process.env.SESSION_SECRET || '').trim();
  if (!secret) {
    throw new Error('SESSION_SECRET is required.');
  }
  return secret;
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function parseBase64Url(text) {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : '';
  return Buffer.from(normalized + pad, 'base64').toString('utf8');
}

function signAuthToken(user) {
  const payload = {
    sub: user.userId,
    login: user.login,
    iat: Date.now(),
    exp: Date.now() + AUTH_TOKEN_TTL_MS
  };

  const body = base64Url(JSON.stringify(payload));
  const signature = base64Url(crypto.createHmac('sha256', getSessionSecret()).update(body).digest());
  return `${body}.${signature}`;
}

async function verifyAuthToken(token) {
  const raw = String(token || '').trim();
  const [body, signature] = raw.split('.');

  if (!body || !signature) {
    return null;
  }

  const expectedSignature = base64Url(crypto.createHmac('sha256', getSessionSecret()).update(body).digest());
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(parseBase64Url(body));
  } catch {
    return null;
  }

  if (!payload?.sub || !payload?.exp || Number(payload.exp) < Date.now()) {
    return null;
  }

  return getUserById(String(payload.sub));
}

async function createOAuthState(source, loginId) {
  const state = randomToken(16);
  await query(
    `INSERT INTO oauth_states (state, source, login_id, created_at, expires_at, used_at)
     VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '10 minutes', NULL)`,
    [state, source || null, loginId || null]
  );

  return state;
}

async function consumeOAuthState(state) {
  const result = await query(`SELECT * FROM oauth_states WHERE state = $1 LIMIT 1`, [state]);
  const existing = result.rows[0];
  if (!existing) {
    return null;
  }

  if (existing.used_at) {
    return null;
  }

  const expired = new Date(existing.expires_at).getTime() <= Date.now();
  if (expired) {
    return null;
  }

  await query(`UPDATE oauth_states SET used_at = NOW() WHERE state = $1`, [state]);
  return existing;
}

async function createVscodeLoginAttempt() {
  const id = randomToken(16);
  await query(
    `INSERT INTO vscode_login_attempts (id, token, user_id, created_at, expires_at, completed_at, consumed_at)
     VALUES ($1, NULL, NULL, NOW(), NOW() + INTERVAL '10 minutes', NULL, NULL)`,
    [id]
  );

  return { id };
}

async function completeVscodeLoginAttempt(loginId, userId, token) {
  if (!loginId) {
    return;
  }

  await query(
    `UPDATE vscode_login_attempts
     SET user_id = $1, token = $2, completed_at = NOW()
     WHERE id = $3 AND expires_at > NOW()`,
    [userId, token, loginId]
  );
}

async function consumeVscodeLoginAttempt(loginId) {
  if (!loginId) {
    return null;
  }

  const result = await query(
    `SELECT * FROM vscode_login_attempts
     WHERE id = $1 AND expires_at > NOW()
     LIMIT 1`,
    [loginId]
  );

  const attempt = result.rows[0];
  if (!attempt || !attempt.user_id || !attempt.token) {
    return null;
  }

  await query(
    `UPDATE vscode_login_attempts
     SET consumed_at = COALESCE(consumed_at, NOW())
     WHERE id = $1`,
    [loginId]
  );

  return {
    loginId: attempt.id,
    userId: attempt.user_id,
    token: attempt.token,
    completedAt: attempt.completed_at
  };
}

async function cleanupExpiredAuthArtifacts() {
  await query(`DELETE FROM oauth_states WHERE expires_at <= NOW()`);
  await query(`DELETE FROM vscode_login_attempts WHERE expires_at <= NOW()`);
}

module.exports = {
  cleanupExpiredAuthArtifacts,
  consumeOAuthState,
  consumeVscodeLoginAttempt,
  createOAuthState,
  createVscodeLoginAttempt,
  completeVscodeLoginAttempt,
  signAuthToken,
  verifyAuthToken,
  LOGIN_ATTEMPT_TTL_MS,
  OAUTH_STATE_TTL_MS
};
