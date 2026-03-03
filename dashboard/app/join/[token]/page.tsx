import Link from 'next/link';
import { redirect } from 'next/navigation';
import { relayPost } from '@/lib/relay-api';
import { getDashboardSession } from '@/lib/session';

export default async function JoinWorkspacePage({ params }: { params: { token: string } }) {
  const session = await getDashboardSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/join/${params.token}`)}`);
  }

  try {
    const data = await relayPost(`/invites/${encodeURIComponent(params.token)}/accept`, session.token, {});
    const projectId = String(data?.projectId || '');
    if (projectId) {
      redirect(`/projects?project=${encodeURIComponent(projectId)}&joined=1`);
    }

    redirect('/projects?joined=1');
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);

    return (
      <main className="page" style={{ maxWidth: 620 }}>
        <section className="card grid">
          <h1 className="title" style={{ fontSize: 22 }}>Unable to join workspace</h1>
          <p className="subtitle">{message}</p>
          <div className="row">
            <Link className="button-primary" href="/projects">Back to Projects</Link>
          </div>
        </section>
      </main>
    );
  }
}
