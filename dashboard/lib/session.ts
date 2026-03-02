import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { getDashboardSessionSecret } from './config';

export interface DashboardSession {
  token: string;
  user: {
    userId: string;
    login: string;
    name?: string | null;
    avatarUrl?: string | null;
  };
  exp: number;
}

const SESSION_COOKIE = 'relay_dashboard_session';
const LOGIN_COOKIE = 'relay_dashboard_login_id';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function base64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function parseBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : '';
  return Buffer.from(normalized + pad, 'base64').toString('utf8');
}

function sign(body: string): string {
  return base64Url(crypto.createHmac('sha256', getDashboardSessionSecret()).update(body).digest('base64'));
}

function encodeSession(session: DashboardSession): string {
  const payload = base64Url(JSON.stringify(session));
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

function decodeSession(raw: string | undefined): DashboardSession | null {
  if (!raw) {
    return null;
  }

  const [payload, signature] = String(raw).split('.');
  if (!payload || !signature) {
    return null;
  }

  const expected = sign(payload);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(parseBase64Url(payload)) as DashboardSession;
    if (!parsed?.token || !parsed?.user?.userId || !parsed?.exp) {
      return null;
    }

    if (Number(parsed.exp) < Date.now()) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function isSecureCookie(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE;
}

export function getLoginCookieName(): string {
  return LOGIN_COOKIE;
}

export async function getDashboardSession(): Promise<DashboardSession | null> {
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE)?.value);
}

export async function setDashboardSession(token: string, user: DashboardSession['user']): Promise<void> {
  const store = await cookies();
  const value = encodeSession({
    token,
    user,
    exp: Date.now() + SESSION_TTL_MS
  });

  store.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookie(),
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000)
  });
}

export async function clearDashboardSession(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookie(),
    path: '/',
    maxAge: 0
  });
}

export async function setPendingLoginId(loginId: string): Promise<void> {
  const store = await cookies();
  store.set(LOGIN_COOKIE, loginId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookie(),
    path: '/',
    maxAge: 60 * 15
  });
}

export async function getPendingLoginId(): Promise<string | null> {
  const store = await cookies();
  return store.get(LOGIN_COOKIE)?.value || null;
}

export async function clearPendingLoginId(): Promise<void> {
  const store = await cookies();
  store.set(LOGIN_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookie(),
    path: '/',
    maxAge: 0
  });
}
