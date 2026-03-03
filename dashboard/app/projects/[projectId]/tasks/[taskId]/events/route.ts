import { NextResponse } from 'next/server';
import { relayGet } from '@/lib/relay-api';
import { getDashboardSession } from '@/lib/session';

function parseError(error: unknown): string {
  const raw = String(error instanceof Error ? error.message : error);
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const payload = JSON.parse(raw.slice(jsonStart));
      return String(payload?.error || payload?.message || raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; taskId: string }> }
) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Not authenticated', events: [] }, { status: 401 });
  }

  const { projectId, taskId } = await context.params;

  try {
    const data = await relayGet(
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/events`,
      session.token
    );

    return NextResponse.json({ ok: true, events: Array.isArray(data?.events) ? data.events : [] });
  } catch (error) {
    return NextResponse.json({ ok: false, error: parseError(error), events: [] }, { status: 400 });
  }
}
