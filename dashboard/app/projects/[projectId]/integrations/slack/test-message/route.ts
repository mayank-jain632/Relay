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

  const target = String(formData.get('target') || 'default_channel').trim();
  const channelId = String(formData.get('channelId') || '').trim();
  const text = String(formData.get('text') || '').trim();

  try {
    await relayPost(`/projects/${encodeURIComponent(projectId)}/slack/test-message`, session.token, {
      target,
      channelId,
      text
    });

    return NextResponse.redirect(new URL(`/projects/${projectId}/integrations/slack?test_sent=1`, request.url));
  } catch (error) {
    const message = encodeURIComponent(String(error instanceof Error ? error.message : error));
    return NextResponse.redirect(new URL(`/projects/${projectId}/integrations/slack?test_error=${message}`, request.url));
  }
}
