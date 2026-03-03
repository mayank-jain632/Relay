import Link from 'next/link';
import { requireDashboardSession } from '@/lib/auth';
import { relayGet } from '@/lib/relay-api';
import { DashboardShell } from '@/components/DashboardShell';

function toText(value: unknown): string {
  return String(value || '').trim();
}

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

  const mappedUsers = Array.isArray(users?.mappedUsers) ? users.mappedUsers : [];
  const unmappedUsers = Array.isArray(users?.unmappedUsers) ? users.unmappedUsers : [];

  return (
    <DashboardShell
      title="Slack Integration"
      subtitle="Use one-click Slack install, send diagnostics instantly, and keep account mapping visible."
      activeNav="slack"
      projectId={projectId}
      activeProjectName={projectName}
      sessionLogin={session.user.login}
      sessionName={session.user.name}
      actions={(
        <>
          <form action={`/projects/${projectId}/integrations/slack/connect`} method="post">
            <button className="button-primary" type="submit">{status?.connected ? 'Reconnect / Reinstall' : 'Connect Slack'}</button>
          </form>
          <Link className="button-secondary" href={`/projects/${projectId}/tasks`}>Go to Tasks</Link>
        </>
      )}
    >
      {searchParams.connected ? <div className="notice">Slack connected successfully.</div> : null}
      {searchParams.test_sent ? <div className="notice">Test message sent successfully.</div> : null}
      {searchParams.error ? <div className="error">{String(searchParams.error)}</div> : null}
      {searchParams.test_error ? <div className="error">{String(searchParams.test_error)}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="card grid">
        <h2 className="card-title">Connection status</h2>
        <p className="muted" style={{ margin: 0 }}>
          Relay runs a single Slack app install flow. Reconnect anytime if scopes change or the bot is removed.
        </p>

        <div className="grid" style={{ gap: 6 }}>
          <div className="row"><span className="muted">Connected:</span><strong>{status?.connected ? 'Yes' : 'No'}</strong></div>
          <div className="row"><span className="muted">Bot installed:</span><strong>{status?.botInstalled ? 'Yes' : 'No'}</strong></div>
          <div className="row"><span className="muted">Workspace:</span><strong>{toText(status?.slackWorkspaceName) || toText(status?.slackWorkspaceId) || 'Unknown'}</strong></div>
          <div className="row"><span className="muted">Connected by:</span><strong>{toText(status?.connectedBy?.name) || toText(status?.connectedBy?.login) || '-'}</strong></div>
          <div className="row"><span className="muted">Last Slack event:</span><strong>{status?.lastEventAt ? new Date(status.lastEventAt).toLocaleString() : 'Never'}</strong></div>
        </div>

        <div className="code">Ingest endpoint: {status?.requestUrl || 'Unavailable'}</div>

        <form action={`/projects/${projectId}/integrations/slack/connect`} method="post" className="row">
          <button className="button-secondary" type="submit">Reconnect Slack</button>
          <button className="button-secondary" type="submit">Reinstall App</button>
        </form>
      </section>

      <section className="card grid">
        <h2 className="card-title">Send test message</h2>
        <p className="muted" style={{ margin: 0 }}>
          Send a quick test to confirm your bot token, workspace routing, and posting permissions before pilot sessions.
        </p>
        <form action={`/projects/${projectId}/integrations/slack/test-message`} method="post" className="grid">
          <div className="row">
            <select className="select" name="target" defaultValue="default_channel">
              <option value="default_channel">Default channel</option>
              <option value="my_dm">My DM (if mapped)</option>
              <option value="custom_channel">Custom channel ID</option>
            </select>
            <input className="input" type="text" name="channelId" placeholder="Optional channel ID (C123...)" />
          </div>
          <textarea
            className="textarea"
            name="text"
            placeholder="Optional custom message. Leave blank for Relay default test text."
          />
          <div className="row">
            <button className="button-primary" type="submit">Send test message</button>
          </div>
        </form>
      </section>

      <section className="card grid">
        <h2 className="card-title">Mapping status</h2>
        <p className="muted" style={{ margin: 0 }}>
          Relay auto-links accounts. This table is optimized for PM visibility; raw identifiers are available in Advanced details.
        </p>

        <table className="table">
          <thead>
            <tr>
              <th>Slack user</th>
              <th>GitHub user</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {mappedUsers.map((entry: any) => {
              const profile = entry.slackProfile || {};
              const avatar = toText(profile.avatarUrl);
              const slackDisplay = toText(profile.displayName) || toText(profile.realName) || toText(profile.handle) || entry.slackUserId;
              const slackHandle = toText(profile.handle);
              const githubLabel = toText(entry.githubLogin) || toText(entry.githubName) || '-';
              return (
                <tr key={`mapped-${entry.slackUserId}-${entry.githubUserId}`}>
                  <td>
                    <div className="mapping-user">
                      {avatar ? <img className="mapping-avatar" src={avatar} alt="Slack avatar" /> : <div className="mapping-avatar-fallback">S</div>}
                      <div>
                        <div>{slackDisplay}</div>
                        {slackHandle ? <div className="muted">@{slackHandle}</div> : null}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="mapping-user">
                      {entry.avatarUrl ? <img className="mapping-avatar" src={entry.avatarUrl} alt="GitHub avatar" /> : <div className="mapping-avatar-fallback">G</div>}
                      <div>
                        <div>{githubLabel}</div>
                        {entry.githubName ? <div className="muted">{entry.githubName}</div> : null}
                      </div>
                    </div>
                  </td>
                  <td><span className="badge done">Mapped</span></td>
                </tr>
              );
            })}

            {unmappedUsers.map((entry: any) => {
              const profile = entry.slackProfile || {};
              const avatar = toText(profile.avatarUrl);
              const slackDisplay = toText(profile.displayName) || toText(profile.realName) || toText(profile.handle) || entry.slackUserId;
              const slackHandle = toText(profile.handle);
              return (
                <tr key={`unmapped-${entry.slackUserId}`}>
                  <td>
                    <div className="mapping-user">
                      {avatar ? <img className="mapping-avatar" src={avatar} alt="Slack avatar" /> : <div className="mapping-avatar-fallback">S</div>}
                      <div>
                        <div>{slackDisplay}</div>
                        {slackHandle ? <div className="muted">@{slackHandle}</div> : null}
                      </div>
                    </div>
                  </td>
                  <td className="muted">Pending GitHub link</td>
                  <td><span className="badge review">Needs link</span></td>
                </tr>
              );
            })}

            {mappedUsers.length === 0 && unmappedUsers.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">No Slack users detected yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Advanced details</summary>
        <div style={{ marginTop: 10 }} className="grid">
          <div className="muted">Legacy slash command URL format: <code>/slack/nudge?projectId={projectId}</code></div>
          <div className="code">Workspace ID: {toText(status?.slackWorkspaceId) || '-'}</div>
          <table className="table">
            <thead>
              <tr>
                <th>Slack raw ID</th>
                <th>GitHub login</th>
              </tr>
            </thead>
            <tbody>
              {mappedUsers.map((entry: any) => (
                <tr key={`raw-${entry.slackUserId}`}>
                  <td>{entry.slackUserId}</td>
                  <td>{entry.githubLogin || '-'}</td>
                </tr>
              ))}
              {unmappedUsers.map((entry: any) => (
                <tr key={`raw-unmapped-${entry.slackUserId}`}>
                  <td>{entry.slackUserId}</td>
                  <td className="muted">Unmapped</td>
                </tr>
              ))}
              {mappedUsers.length === 0 && unmappedUsers.length === 0 ? (
                <tr>
                  <td colSpan={2} className="muted">No raw IDs to show.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </details>
    </DashboardShell>
  );
}
