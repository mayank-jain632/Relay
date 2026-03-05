import { NextResponse } from 'next/server';
import { requireDashboardSession } from '@/lib/auth';
import { relayPost } from '@/lib/relay-api';
import { clearActiveProjectId } from '@/lib/session';

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;

  try {
    const session = await requireDashboardSession();
    await relayPost(`/projects/${encodeURIComponent(projectId)}/delete`, session.token, {});
    await clearActiveProjectId();

    return NextResponse.redirect(new URL('/projects?project_deleted=1', request.url));
  } catch (error) {
    const message = encodeURIComponent(String(error instanceof Error ? error.message : error));
    return NextResponse.redirect(new URL(`/projects?error=${message}`, request.url));
  }
}
