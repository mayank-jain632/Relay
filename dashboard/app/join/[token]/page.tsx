import { redirect } from 'next/navigation';
import { relayPost } from '@/lib/relay-api';
import { getDashboardSession } from '@/lib/session';

export default async function JoinWorkspacePage({ params }: { params: { token: string } }) {
  const session = await getDashboardSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/join/${params.token}`)}`);
  }

  const data = await relayPost(`/invites/${encodeURIComponent(params.token)}/accept`, session.token, {});
  const projectId = String(data?.projectId || '');

  if (projectId) {
    redirect(`/projects?project=${encodeURIComponent(projectId)}&joined=1`);
  }

  redirect('/projects?joined=1');
}
