import { NextResponse } from 'next/server';
import { relayAuthStart } from '@/lib/relay-api';
import { setPendingLoginId, setPendingLoginNext } from '@/lib/session';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const nextPath = String(url.searchParams.get('next') || '/projects');
    const started = await relayAuthStart();
    await setPendingLoginId(started.loginId);
    await setPendingLoginNext(nextPath);
    return NextResponse.redirect(started.loginUrl);
  } catch (error) {
    const message = encodeURIComponent(String(error instanceof Error ? error.message : error));
    return NextResponse.redirect(new URL(`/login?error=${message}`, request.url));
  }
}
