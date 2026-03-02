import Link from 'next/link';
import { requireDashboardSession } from '@/lib/auth';
import { relayGet } from '@/lib/relay-api';
import { DashboardShell } from '@/components/DashboardShell';

const REQUIRED_SCOPES = ['commands', 'chat:write', 'app_mentions:read', 'channels:history'];
const RECOMMENDED_EVENTS = ['app_mention', 'message.channels'];

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
      title="Connect Slack"
      subtitle="Set up Slack once, then task updates will sync automatically."
      activeNav="slack"
      projectId={projectId}
      activeProjectName={projectName}
      sessionLogin={session.user.login}
      sessionName={session.user.name}
      actions={<Link className="button-secondary" href={`/projects/${projectId}/tasks`}>Go to Tasks</Link>}
    >
      {searchParams.mapped ? <div className="notice">Teammate mapping saved.</div> : null}
      {searchParams.error ? <div className="error">{String(searchParams.error)}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="card grid">
        <h2 className="card-title">Step 1: Paste this URL in Slack</h2>
        <p className="muted" style={{ margin: 0 }}>
          In your Slack app settings, open Event Subscriptions and paste this request URL.
        </p>
        <div className="code">{status?.requestUrl || 'Unavailable'}</div>
        <div className="row">
          <span className="muted">Connection status:</span>
          <strong>{status?.verified ? 'Verified' : 'Not verified yet'}</strong>
          <span className="muted">Last Slack event:</span>
          <strong>{status?.lastEventAt ? new Date(status.lastEventAt).toLocaleString() : 'Never'}</strong>
        </div>
      </section>

      <section className="card grid">
        <h2 className="card-title">Step 2: Enable these Slack permissions</h2>
        <div className="grid two-col" style={{ gap: 10 }}>
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>Required bot scopes</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {REQUIRED_SCOPES.map((scope) => (
                <li key={scope}>{scope}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>Recommended event subscriptions</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {RECOMMENDED_EVENTS.map((eventName) => (
                <li key={eventName}>{eventName}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="card grid">
        <h2 className="card-title">Step 3: Match Slack users to teammates</h2>
        <p className="muted" style={{ margin: 0 }}>
          This lets “My Tasks” show the right tasks for each person.
        </p>
        <form className="row" action={`/projects/${projectId}/integrations/slack/map`} method="post">
          <select className="select" name="slackUserId" required defaultValue="">
            <option value="" disabled>Select Slack user</option>
            {(users?.unmappedUsers || []).map((entry: any) => (
              <option key={entry.slackUserId} value={entry.slackUserId}>
                {entry.slackUserId}
              </option>
            ))}
          </select>
          <input className="input" type="text" name="githubLogin" placeholder="github username" required />
          <button className="button-primary" type="submit">Save Mapping</button>
        </form>
      </section>

      <section className="card grid">
        <h2 className="card-title">Current teammate mappings</h2>
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
      </section>

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Advanced Slack details</summary>
        <p className="muted" style={{ marginTop: 10 }}>
          Slash command request URL format: <code>/slack/nudge?projectId={projectId}</code>
        </p>
      </details>
    </DashboardShell>
  );
}
