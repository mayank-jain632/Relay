import { NextResponse } from 'next/server';
import { relayPost } from '@/lib/relay-api';
import { getDashboardSession } from '@/lib/session';

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { projectId } = await context.params;
  const formData = await request.formData();
  const githubLogin = String(formData.get('githubLogin') || '').trim();
  const role = String(formData.get('role') || 'member').trim();

  if (!githubLogin) {
    return NextResponse.redirect(new URL('/projects?error=missing_github_login', request.url));
  }

  try {
    await relayPost(`/projects/${encodeURIComponent(projectId)}/members`, session.token, { githubLogin, role });
    return NextResponse.redirect(new URL('/projects?member_added=1', request.url));
  } catch (error) {
    const message = encodeURIComponent(String(error instanceof Error ? error.message : error));
    return NextResponse.redirect(new URL(`/projects?error=${message}`, request.url));
  }
}
