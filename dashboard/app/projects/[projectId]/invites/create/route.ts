import { NextResponse } from 'next/server';
import { relayPost } from '@/lib/relay-api';
import { getDashboardSession } from '@/lib/session';

export async function POST(request: Request, context: { params: { projectId: string } }) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { projectId } = context.params;

  try {
    const data = await relayPost(`/projects/${encodeURIComponent(projectId)}/invites`, session.token, {});
    const inviteUrl = encodeURIComponent(String(data?.invite?.joinUrl || ''));
    return NextResponse.redirect(new URL(`/projects?project=${projectId}&invite_created=1&invite_url=${inviteUrl}`, request.url));
  } catch (error) {
    const message = encodeURIComponent(String(error instanceof Error ? error.message : error));
    return NextResponse.redirect(new URL(`/projects?project=${projectId}&error=${message}`, request.url));
  }
}
