import { NextResponse } from 'next/server';
import { clearActiveProjectId, getDashboardSession, setActiveProjectId } from '@/lib/session';

function sanitizeNextPath(nextParam: string | null): string {
  const raw = String(nextParam || '/projects').trim();
  if (!raw.startsWith('/')) {
    return '/projects';
  }
  if (raw.startsWith('//')) {
    return '/projects';
  }
  return raw;
}

export async function GET(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const url = new URL(request.url);
  const projectId = String(url.searchParams.get('project') || '').trim();
  const nextPath = sanitizeNextPath(url.searchParams.get('next'));

  if (projectId) {
    await setActiveProjectId(projectId);
  } else {
    await clearActiveProjectId();
  }

  const destination = new URL(nextPath, request.url);
  if (projectId && destination.pathname === '/projects') {
    destination.searchParams.set('project', projectId);
  }

  return NextResponse.redirect(destination);
}
