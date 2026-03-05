import { NextResponse } from 'next/server';
import { relayPost } from '@/lib/relay-api';
import { getDashboardSession } from '@/lib/session';

function toFriendlySlackTestError(error: unknown): string {
  const raw = String(error instanceof Error ? error.message : error || 'Unknown error');

  if (raw.includes('No Slack destination found')) {
    return 'No default channel is set yet. Choose "Custom channel ID", paste a channel ID (starts with C), and send once. Then "Default channel" will work.';
  }

  if (raw.includes('channel_not_found')) {
    return 'Channel not found. Double-check the channel ID (it should start with C).';
  }

  if (raw.includes('not_in_channel')) {
    return 'Relay bot is not in that channel yet. Invite it to the channel with "/invite @Relay", then retry.';
  }

  if (raw.includes('invalid_auth') || raw.includes('account_inactive')) {
    return 'Slack token is invalid or expired. Click Reconnect / Reinstall and try again.';
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
    const message = encodeURIComponent(toFriendlySlackTestError(error));
    return NextResponse.redirect(new URL(`/projects/${projectId}/integrations/slack?test_error=${message}`, request.url));
  }
}
