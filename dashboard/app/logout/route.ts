import { NextResponse } from 'next/server';
import { clearDashboardSessionCookie, clearPendingLoginCookies } from '@/lib/session';

// Keep GET side-effect free to avoid accidental sign-outs from route prefetching.
export async function GET(request: Request) {
  return NextResponse.redirect(new URL('/login', request.url));
}

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL('/login', request.url));
  clearDashboardSessionCookie(response);
  clearPendingLoginCookies(response);
  return response;
}
