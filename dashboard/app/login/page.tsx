import Link from 'next/link';
import { getDashboardSession, getPendingLoginId } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getDashboardSession();
  if (session) {
    redirect('/projects');
  }

  const pendingLoginId = await getPendingLoginId();
  const resolvedSearchParams = await searchParams;
  const pending = resolvedSearchParams.pending === '1';
  const error = resolvedSearchParams.error ? String(resolvedSearchParams.error) : '';
  const nextPath = resolvedSearchParams.next ? String(resolvedSearchParams.next) : '/projects';

  return (
    <main className="page" style={{ maxWidth: 520 }}>
      <section className="card grid">
        <h1 className="title" style={{ fontSize: 22 }}>Relay Dashboard</h1>
        <p className="subtitle">Sign in with GitHub to manage projects, Slack setup, and tasks.</p>

        {pending ? <div className="notice">GitHub sign-in is still pending. Finish the GitHub flow tab, then click Complete sign in.</div> : null}
        {error ? <div className="error">{error}</div> : null}

        <div className="row">
          <Link className="button-primary" href={`/auth/start?next=${encodeURIComponent(nextPath)}`}>Sign in with GitHub</Link>
          {pendingLoginId ? <Link className="button-secondary" href="/auth/complete">Complete sign in</Link> : null}
        </div>
      </section>
    </main>
  );
}
