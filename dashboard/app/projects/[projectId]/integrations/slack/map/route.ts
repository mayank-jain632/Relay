import { NextResponse } from 'next/server';
import { relayPost } from '@/lib/relay-api';
import { getDashboardSession } from '@/lib/session';

export async function POST(request: Request, context: { params: { projectId: string } }) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { projectId } = context.params;
  const formData = await request.formData();
  const slackUserId = String(formData.get('slackUserId') || '').trim();
  const githubLogin = String(formData.get('githubLogin') || '').trim();

  if (!slackUserId || !githubLogin) {
    return NextResponse.redirect(new URL(`/projects/${projectId}/integrations/slack?error=missing_fields`, request.url));
  }

  try {
    await relayPost(`/projects/${encodeURIComponent(projectId)}/slack/map-user`, session.token, {
      slackUserId,
      githubLogin
    });
    return NextResponse.redirect(new URL(`/projects/${projectId}/integrations/slack?mapped=1`, request.url));
  } catch (error) {
    const message = encodeURIComponent(String(error instanceof Error ? error.message : error));
    return NextResponse.redirect(new URL(`/projects/${projectId}/integrations/slack?error=${message}`, request.url));
  }
}
