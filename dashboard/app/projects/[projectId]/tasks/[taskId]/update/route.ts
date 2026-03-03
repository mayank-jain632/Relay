import { NextResponse } from 'next/server';
import { relayPatch } from '@/lib/relay-api';
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

export async function POST(
  request: Request,
  context: { params: { projectId: string; taskId: string } }
) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  }

  const { projectId, taskId } = context.params;

  let payload: Record<string, unknown> = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON payload' }, { status: 400 });
  }

  try {
    const data = await relayPatch(
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
      session.token,
      payload
    );

    return NextResponse.json({ ok: true, task: data?.task || null, warning: data?.warning || null });
  } catch (error) {
    return NextResponse.json({ ok: false, error: parseError(error) }, { status: 400 });
  }
}
