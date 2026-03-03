import { NextResponse } from 'next/server';
import { clearDashboardSessionCookie, clearPendingLoginCookies } from '@/lib/session';

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL('/login', request.url));
  clearDashboardSessionCookie(response);
  clearPendingLoginCookies(response);
  return response;
}
