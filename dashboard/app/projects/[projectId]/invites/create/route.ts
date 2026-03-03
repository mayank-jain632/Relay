import { NextResponse } from 'next/server';
import { getAdminApiKey } from '@/lib/config';
import { relayAdminPost, relayPost } from '@/lib/relay-api';
import { getDashboardSession } from '@/lib/session';

export async function POST(request: Request, context: { params: { projectId: string } }) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { projectId } = context.params;
  const encodedProjectId = encodeURIComponent(projectId);
  const formData = await request.formData().catch(() => null);
  const menuProject = encodeURIComponent(String(formData?.get('menu_project') || projectId));

  try {
    const data = await relayPost(`/projects/${encodedProjectId}/invites`, session.token, {});
    const inviteUrl = encodeURIComponent(String(data?.invite?.joinUrl || ''));
    return NextResponse.redirect(new URL(`/projects?project=${encodedProjectId}&invite_created=1&invite_url=${inviteUrl}&menu_open=1&menu_project=${menuProject}`, request.url));
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    const adminKey = getAdminApiKey();

    // Legacy project fix: if user is member-but-not-owner, auto-promote then retry once.
    if (adminKey && message.includes('Owner role required')) {
      try {
        await relayAdminPost(`/admin/projects/${encodedProjectId}/members`, adminKey, {
          githubLogin: session.user.login,
          userId: session.user.userId,
          role: 'owner'
        });

        const retried = await relayPost(`/projects/${encodedProjectId}/invites`, session.token, {});
        const inviteUrl = encodeURIComponent(String(retried?.invite?.joinUrl || ''));
        return NextResponse.redirect(new URL(`/projects?project=${encodedProjectId}&invite_created=1&invite_url=${inviteUrl}&menu_open=1&menu_project=${menuProject}`, request.url));
      } catch (fallbackError) {
        const fallbackMessage = encodeURIComponent(String(fallbackError instanceof Error ? fallbackError.message : fallbackError));
        return NextResponse.redirect(new URL(`/projects?project=${encodedProjectId}&error=${fallbackMessage}&menu_open=1&menu_project=${menuProject}`, request.url));
      }
    }

    const encoded = encodeURIComponent(message);
    return NextResponse.redirect(new URL(`/projects?project=${encodedProjectId}&error=${encoded}&menu_open=1&menu_project=${menuProject}`, request.url));
  }
}
