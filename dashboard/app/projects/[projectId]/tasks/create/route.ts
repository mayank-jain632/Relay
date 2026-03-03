import { NextResponse } from 'next/server';
import { relayPost } from '@/lib/relay-api';
import { getDashboardSession } from '@/lib/session';

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { projectId } = await context.params;
  const formData = await request.formData();

  const title = String(formData.get('title') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const assigneeUserId = String(formData.get('assigneeUserId') || '').trim();

  if (!title) {
    return NextResponse.redirect(new URL(`/projects/${projectId}/tasks?error=missing_title`, request.url));
  }

  try {
    await relayPost(`/projects/${encodeURIComponent(projectId)}/tasks`, session.token, {
      title,
      description,
      assigneeUserId: assigneeUserId || undefined
    });

    return NextResponse.redirect(new URL(`/projects/${projectId}/tasks?created=1`, request.url));
  } catch (error) {
    const message = encodeURIComponent(String(error instanceof Error ? error.message : error));
    return NextResponse.redirect(new URL(`/projects/${projectId}/tasks?error=${message}`, request.url));
  }
}
