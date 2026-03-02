import Link from 'next/link';
import { requireDashboardSession } from '@/lib/auth';
import { relayGet } from '@/lib/relay-api';

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
  let error = '';

  try {
    const [statusData, userData] = await Promise.all([
      relayGet(`/projects/${encodeURIComponent(projectId)}/slack/status`, session.token),
      relayGet(`/projects/${encodeURIComponent(projectId)}/slack/users`, session.token)
    ]);
    status = statusData;
    users = userData;
  } catch (err) {
    error = String(err instanceof Error ? err.message : err);
  }

  return (
    <main className="page grid">
      <header className="header">
        <div>
          <h1 className="title">Slack Integration</h1>
          <p className="subtitle">Project {projectId}</p>
        </div>
        <div className="row">
          <Link className="button-secondary" href="/projects">Back</Link>
          <Link className="button-secondary" href={`/projects/${projectId}/tasks`}>Tasks</Link>
        </div>
      </header>

      {searchParams.mapped ? <div className="notice">Slack user mapping saved.</div> : null}
      {searchParams.error ? <div className="error">{String(searchParams.error)}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="card grid">
        <h2 style={{ margin: 0, fontSize: 18 }}>Request URL</h2>
        <div className="code">{status?.requestUrl || 'Unavailable'}</div>
        <p className="muted">
          Paste this into Slack Event Subscriptions URL and your slash-command Request URL
          (for slash command use <code>/slack/nudge?projectId={projectId}</code>).
        </p>
        <div className="row">
          <span className="muted">Verified:</span>
          <strong>{status?.verified ? 'Yes' : 'No'}</strong>
          <span className="muted">Last event:</span>
          <strong>{status?.lastEventAt ? new Date(status.lastEventAt).toLocaleString() : 'Never'}</strong>
        </div>
      </section>

      <section className="card grid">
        <h2 style={{ margin: 0, fontSize: 18 }}>Slack Checklist</h2>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>Required bot scopes</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {REQUIRED_SCOPES.map((scope) => (
                <li key={scope}>{scope}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>Recommended bot events</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {RECOMMENDED_EVENTS.map((eventName) => (
                <li key={eventName}>{eventName}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="card grid">
        <h2 style={{ margin: 0, fontSize: 18 }}>Map Slack User to GitHub Login</h2>
        <form className="row" action={`/projects/${projectId}/integrations/slack/map`} method="post">
          <select className="select" name="slackUserId" required defaultValue="">
            <option value="" disabled>Select Slack user</option>
            {(users?.unmappedUsers || []).map((entry: any) => (
              <option key={entry.slackUserId} value={entry.slackUserId}>
                {entry.slackUserId}
              </option>
            ))}
          </select>
          <input className="input" type="text" name="githubLogin" placeholder="github login" required />
          <button className="button-primary" type="submit">Map User</button>
        </form>
      </section>

      <section className="card grid">
        <h2 style={{ margin: 0, fontSize: 18 }}>Mapped Users</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Slack User</th>
              <th>GitHub Login</th>
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
    </main>
  );
}
