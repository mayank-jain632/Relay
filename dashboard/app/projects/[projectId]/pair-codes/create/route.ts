import { NextResponse } from 'next/server';
import { relayPost } from '@/lib/relay-api';
import { getDashboardSession } from '@/lib/session';

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { projectId } = await context.params;
  const formData = await request.formData().catch(() => null);
  const menuProject = encodeURIComponent(String(formData?.get('menu_project') || projectId));

  try {
    const data = await relayPost(`/projects/${encodeURIComponent(projectId)}/pair-codes`, session.token, {});
    const pairCode = encodeURIComponent(String(data?.pairCode?.code || ''));
    const pairExpires = encodeURIComponent(String(data?.pairCode?.expiresAt || ''));
    return NextResponse.redirect(new URL(`/projects?project=${projectId}&paired=1&pair_code=${pairCode}&pair_expires=${pairExpires}&menu_open=1&menu_project=${menuProject}`, request.url));
  } catch (error) {
    const message = encodeURIComponent(String(error instanceof Error ? error.message : error));
    return NextResponse.redirect(new URL(`/projects?project=${projectId}&error=${message}&menu_open=1&menu_project=${menuProject}`, request.url));
  }
}
