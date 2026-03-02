import { NextResponse } from 'next/server';
import { relayPatch } from '@/lib/relay-api';
import { getDashboardSession } from '@/lib/session';

export async function POST(
  request: Request,
  context: { params: { projectId: string; taskId: string } }
) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { projectId, taskId } = context.params;
  const formData = await request.formData();
  const status = String(formData.get('status') || '').trim();
  const assignedToUserIdRaw = String(formData.get('assignedToUserId') || '').trim();

  const patch: Record<string, unknown> = {};
  if (status) {
    patch.status = status;
  }

  if (assignedToUserIdRaw === '__none__') {
    patch.assignedToUserId = null;
  } else if (assignedToUserIdRaw) {
    patch.assignedToUserId = assignedToUserIdRaw;
  }

  try {
    await relayPatch(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`, session.token, patch);
    return NextResponse.redirect(new URL(`/projects/${projectId}/tasks?updated=1`, request.url));
  } catch (error) {
    const message = encodeURIComponent(String(error instanceof Error ? error.message : error));
    return NextResponse.redirect(new URL(`/projects/${projectId}/tasks?error=${message}`, request.url));
  }
}
