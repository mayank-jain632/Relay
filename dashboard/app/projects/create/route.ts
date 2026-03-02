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
    const adminKey = getAdminApiKey();
    if (adminKey) {
      await relayAdminPost('/admin/projects', adminKey, { name, ownerGithubLogin: session.user.login });
    } else {
      await relayPost('/projects', session.token, { name });
    }

    return NextResponse.redirect(new URL('/projects?created=1', request.url));
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (message.includes('403') && message.toLowerCase().includes('admin')) {
      return NextResponse.redirect(new URL('/projects?error=admin_required', request.url));
    }

    const encoded = encodeURIComponent(message);
    return NextResponse.redirect(new URL(`/projects?error=${encoded}`, request.url));
  }
}
