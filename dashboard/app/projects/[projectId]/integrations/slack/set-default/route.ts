import { NextResponse } from 'next/server';
import { relayPost } from '@/lib/relay-api';
import { getDashboardSession } from '@/lib/session';

function toFriendlyDefaultChannelError(error: unknown): string {
  const raw = String(error instanceof Error ? error.message : error || 'Unknown error');

  if (raw.includes('Connect Slack first')) {
    return 'Connect Slack first, then set a default channel.';
  }

  if (raw.includes('Invalid channel ID format')) {
    return 'Channel ID format is invalid. Use a Slack channel ID like C0123ABCD.';
  }

  return raw;
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { projectId } = await context.params;
  const formData = await request.formData();
  const channelId = String(formData.get('channelId') || '').trim();

  try {
    await relayPost(`/projects/${encodeURIComponent(projectId)}/slack/default-channel`, session.token, { channelId });
    return NextResponse.redirect(new URL(`/projects/${projectId}/integrations/slack?default_set=1`, request.url));
  } catch (error) {
    const message = encodeURIComponent(toFriendlyDefaultChannelError(error));
    return NextResponse.redirect(new URL(`/projects/${projectId}/integrations/slack?default_error=${message}`, request.url));
  }
}
