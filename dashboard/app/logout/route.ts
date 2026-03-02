import { NextResponse } from 'next/server';
import { clearDashboardSession, clearPendingLoginId } from '@/lib/session';

export async function GET(request: Request) {
  await clearDashboardSession();
  await clearPendingLoginId();
  return NextResponse.redirect(new URL('/login', request.url));
}
