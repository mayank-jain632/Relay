import { NextResponse } from 'next/server';
import { getAdminApiKey } from '@/lib/config';
import { relayAdminPost, relayPost } from '@/lib/relay-api';
import { getDashboardSession } from '@/lib/session';

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const formData = await request.formData();
  const name = String(formData.get('name') || '').trim();
  if (!name) {
    return NextResponse.redirect(new URL('/projects?error=project_name_required', request.url));
  }

  try {
    // Primary path: authenticated create guarantees creator is owner.
    await relayPost('/projects', session.token, { name });
    return NextResponse.redirect(new URL('/projects?created=1', request.url));
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    const adminKey = getAdminApiKey();

    // Backward-compatible fallback for deployments still enforcing admin-only creation.
    if (adminKey && message.includes('403') && message.toLowerCase().includes('admin')) {
      try {
        await relayAdminPost('/admin/projects', adminKey, {
          name,
          ownerGithubLogin: session.user.login,
          ownerUserId: session.user.userId
        });
        return NextResponse.redirect(new URL('/projects?created=1', request.url));
      } catch (fallbackError) {
        const fallbackMessage = encodeURIComponent(String(fallbackError instanceof Error ? fallbackError.message : fallbackError));
        return NextResponse.redirect(new URL('/projects?error=' + fallbackMessage, request.url));
      }
    }

    const encoded = encodeURIComponent(message);
    return NextResponse.redirect(new URL('/projects?error=' + encoded, request.url));
  }
}
