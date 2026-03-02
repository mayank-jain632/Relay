import { NextResponse } from 'next/server';
import { relayAuthPollToken } from '@/lib/relay-api';
import { clearPendingLoginId, getPendingLoginId, setDashboardSession } from '@/lib/session';

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request) {
  const loginId = await getPendingLoginId();
  if (!loginId) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  for (let attempt = 0; attempt < 15; attempt += 1) {
    const result = await relayAuthPollToken(loginId);
    if (result?.token && result.user) {
      await setDashboardSession(result.token, {
        userId: String(result.user.userId || result.user.id || ''),
        login: String(result.user.login || ''),
        name: result.user.name || null,
        avatarUrl: result.user.avatarUrl || null
      });
      await clearPendingLoginId();
      return NextResponse.redirect(new URL('/projects', request.url));
    }

    if (attempt < 14) {
      await sleep(1000);
    }
  }

  return NextResponse.redirect(new URL('/login?pending=1', request.url));
}
