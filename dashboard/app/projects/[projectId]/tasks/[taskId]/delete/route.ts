import { NextResponse } from 'next/server';
import { requireDashboardSession } from '@/lib/auth';
import { relayPost } from '@/lib/relay-api';

export async function POST(request: Request, context: { params: Promise<{ projectId: string; taskId: string }> }) {
  const { projectId, taskId } = await context.params;

  try {
    const session = await requireDashboardSession();
    await relayPost(
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/delete`,
      session.token,
      {}
    );

    return NextResponse.redirect(new URL(`/projects/${projectId}/tasks?deleted=1`, request.url));
  } catch (error) {
    const message = encodeURIComponent(String(error instanceof Error ? error.message : error));
    return NextResponse.redirect(new URL(`/projects/${projectId}/tasks?error=${message}`, request.url));
  }
}
