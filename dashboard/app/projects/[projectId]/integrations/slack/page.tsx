import Link from 'next/link';
import { requireDashboardSession } from '@/lib/auth';
import { relayGet } from '@/lib/relay-api';
import { DashboardShell } from '@/components/DashboardShell';

export default async function SlackIntegrationPage({
  params,
  searchParams
}: {
  params: { projectId: string };
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const session = await requireDashboardSession();
  const { projectId } = params;

  let status: any = null;
  let users: any = null;
  let projectName = projectId;
  let error = '';

  try {
    const [statusData, userData, projectsData] = await Promise.all([
      relayGet(`/projects/${encodeURIComponent(projectId)}/slack/status`, session.token),
      relayGet(`/projects/${encodeURIComponent(projectId)}/slack/users`, session.token),
      relayGet('/projects', session.token)
    ]);
    status = statusData;
    users = userData;

    const projects = Array.isArray(projectsData?.projects) ? projectsData.projects : [];
    const active = projects.find((project: any) => project.id === projectId);
    if (active?.name) {
      projectName = active.name;
    }
  } catch (err) {
    error = String(err instanceof Error ? err.message : err);
  }

  return (
    <DashboardShell
      title="Slack Integration"
      subtitle="Connect Slack once. Relay will route messages and task updates automatically."
      activeNav="slack"
      projectId={projectId}
      activeProjectName={projectName}
      sessionLogin={session.user.login}
      sessionName={session.user.name}
      actions={(
        <>
          <form action={`/projects/${projectId}/integrations/slack/connect`} method="post">
            <button className="button-primary" type="submit">Connect Slack</button>
          </form>
          <Link className="button-secondary" href={`/projects/${projectId}/tasks`}>Go to Tasks</Link>
        </>
      )}
    >
      {searchParams.connected ? <div className="notice">Slack connected successfully.</div> : null}
      {searchParams.error ? <div className="error">{String(searchParams.error)}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="card grid">
        <h2 className="card-title">Connection status</h2>
        <p className="muted" style={{ margin: 0 }}>
          Use the Connect Slack button above. You do not need to create a separate Slack app.
        </p>
        <div className="row">
          <span className="muted">Connected:</span>
          <strong>{status?.connected ? 'Yes' : 'No'}</strong>
          <span className="muted">Bot installed:</span>
          <strong>{status?.botInstalled ? 'Yes' : 'No'}</strong>
          <span className="muted">Last Slack event:</span>
          <strong>{status?.lastEventAt ? new Date(status.lastEventAt).toLocaleString() : 'Never'}</strong>
        </div>
        <div className="code">Ingest endpoint: {status?.requestUrl || 'Unavailable'}</div>
      </section>

      <section className="card grid">
        <h2 className="card-title">Account linking</h2>
        <p className="muted" style={{ margin: 0 }}>
          Relay now links Slack users automatically. If someone is not linked yet, Relay bot DMs them a GitHub link flow.
        </p>
      </section>

      <section className="card grid">
        <h2 className="card-title">Current mapping status</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Slack user</th>
              <th>GitHub username</th>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            {(users?.mappedUsers || []).map((entry: any) => (
              <tr key={`${entry.slackUserId}-${entry.githubLogin}`}>
                <td>{entry.slackUserId}</td>
                <td>{entry.githubLogin}</td>
                <td>{entry.githubName || '-'}</td>
              </tr>
            ))}
            {(users?.mappedUsers || []).length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">No mappings yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="muted" style={{ margin: 0 }}>
          Unmapped Slack users detected: {(users?.unmappedUsers || []).length}
        </p>
      </section>

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Advanced details</summary>
        <p className="muted" style={{ marginTop: 10 }}>
          Legacy slash command URL format: <code>/slack/nudge?projectId={projectId}</code>
        </p>
      </details>
    </DashboardShell>
  );
}
