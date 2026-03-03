import Link from 'next/link';
import { requireDashboardSession } from '@/lib/auth';
import { relayGet } from '@/lib/relay-api';
import { DashboardShell } from '@/components/DashboardShell';
import { CopyButton } from '@/components/CopyButton';
import { WorkspaceActionsMenu } from '@/components/WorkspaceActionsMenu';

interface ProjectItem {
  id: string;
  name: string;
  role: string;
  createdAt: string;
}

interface OnboardingState {
  workspaceCreated: boolean;
  slackConnected: boolean;
  extensionLinked: boolean;
  firstTaskCreated: boolean;
  slackWorkspaceId?: string | null;
  lastSlackEventAt?: string | null;
  pairCodesGenerated?: number;
  pairCodesConsumed?: number;
  taskCount?: number;
}

function renderError(errorParam: string | string[] | undefined): string {
  if (!errorParam) {
    return '';
  }

  const raw = Array.isArray(errorParam) ? errorParam[0] : errorParam;
  if (raw === 'project_name_required') {
    return 'Please enter a workspace name first.';
  }

  if (raw === 'admin_required') {
    return 'Project creation is restricted. Ask your Relay admin to set DASHBOARD_ADMIN_API_KEY in dashboard/.env and restart.';
  }

  return String(raw);
}

function checklistItem(label: string, done: boolean) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
      <span>{label}</span>
      <span className={done ? 'badge done' : 'badge todo'}>{done ? 'Done' : 'Pending'}</span>
    </div>
  );
}

export default async function ProjectsPage({
  searchParams
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const session = await requireDashboardSession();

  let projects: ProjectItem[] = [];
  let onboarding: OnboardingState | null = null;
  let error = '';

  try {
    const data = await relayGet('/projects', session.token);
    projects = Array.isArray(data?.projects) ? data.projects : [];
  } catch (err) {
    error = String(err instanceof Error ? err.message : err);
  }

  const projectParam = typeof searchParams.project === 'string' ? searchParams.project : '';
  const selectedProject = projects.find((project) => project.id === projectParam) ?? projects[0];
  const navProjectId = selectedProject?.id;
  const uiError = renderError(searchParams.error);

  if (navProjectId) {
    try {
      const stateData = await relayGet(`/projects/${encodeURIComponent(navProjectId)}/onboarding`, session.token);
      onboarding = stateData?.onboarding || null;
    } catch {
      onboarding = null;
    }
  }

  const pairCode = typeof searchParams.pair_code === 'string' ? searchParams.pair_code : '';
  const pairExpires = typeof searchParams.pair_expires === 'string' ? searchParams.pair_expires : '';
  const inviteUrl = typeof searchParams.invite_url === 'string' ? searchParams.invite_url : '';
  const keepMenuOpen = searchParams.menu_open === '1';
  const menuProjectId = typeof searchParams.menu_project === 'string' ? searchParams.menu_project : '';
  const extensionCopied = searchParams.extension_copied === '1';
  const setupChecklistComplete = Boolean(
    onboarding?.workspaceCreated && onboarding?.slackConnected && (onboarding?.extensionLinked || extensionCopied)
  );

  const pairCopyRedirect = selectedProject
    ? `/projects?project=${encodeURIComponent(selectedProject.id)}&extension_copied=1`
    : '/projects?extension_copied=1';

  return (
    <DashboardShell
      title="Workspace Onboarding"
      subtitle="Set up Relay in minutes: connect Slack, pair the extension, and invite your team."
      activeNav="projects"
      projectId={navProjectId}
      activeProjectName={selectedProject?.name}
      sessionLogin={session.user.login}
      sessionName={session.user.name}
      actions={navProjectId ? (
        <>
          <Link className="button-secondary" href={`/projects/${navProjectId}/integrations/slack`}>Slack</Link>
          <Link className="button-secondary" href={`/projects/${navProjectId}/tasks`}>Tasks</Link>
        </>
      ) : null}
    >
      {searchParams.created ? <div className="notice">Workspace created. Continue with Connect Slack.</div> : null}
      {searchParams.connected ? <div className="notice">Slack connected successfully.</div> : null}
      {searchParams.paired ? <div className="notice">Pair code generated. Use it in VS Code: Relay: Link Workspace.</div> : null}
      {searchParams.invite_created ? <div className="notice">Invite link generated.</div> : null}
      {extensionCopied ? <div className="notice">Pair code copied. Extension setup marked complete for onboarding.</div> : null}
      {uiError ? <div className="error">{uiError}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="card grid">
        <h2 className="card-title">1. Create workspace</h2>
        <p className="muted" style={{ margin: 0 }}>Pick a simple team name. Example: Product Engineering.</p>
        <form action="/projects/create" method="post" className="row">
          <input className="input" type="text" name="name" placeholder="Product Engineering" required style={{ minWidth: 320 }} />
          <button className="button-primary" type="submit">Create Workspace</button>
        </form>
      </section>

      {selectedProject && !setupChecklistComplete ? (
        <section className="card grid">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 className="card-title" style={{ marginBottom: 4 }}>{selectedProject.name}</h2>
              <p className="subtitle" style={{ margin: 0 }}>Role: {selectedProject.role}</p>
            </div>
            <Link className="button-secondary" href={`/projects?project=${selectedProject.id}`}>Set Active</Link>
          </div>

          <div className="grid" style={{ gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Progress checklist</h3>
            {checklistItem('Workspace created', Boolean(onboarding?.workspaceCreated))}
            {checklistItem('Slack connected', Boolean(onboarding?.slackConnected))}
            {checklistItem('Extension linked', Boolean(onboarding?.extensionLinked || extensionCopied))}
          </div>

          <div className="grid two-col">
            <div className="card" style={{ background: 'var(--surface-soft)' }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>2. Connect Slack</h3>
              <p className="muted" style={{ margin: '0 0 10px' }}>One click installs Relay app to your Slack workspace.</p>
              <form action={`/projects/${selectedProject.id}/integrations/slack/connect`} method="post">
                <button className="button-primary" type="submit">Connect Slack</button>
              </form>
              <p className="muted" style={{ margin: '10px 0 0' }}>
                Status: {onboarding?.slackConnected ? 'Connected' : 'Not connected'}
                {onboarding?.lastSlackEventAt ? ` · Last event ${new Date(onboarding.lastSlackEventAt).toLocaleString()}` : ''}
              </p>
            </div>

            <div className="card" style={{ background: 'var(--surface-soft)' }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>3. Install extension</h3>
              <p className="muted" style={{ margin: '0 0 10px' }}>
                In VS Code, run <code>Relay: Link Workspace</code> and paste a pair code.
              </p>
              <form action={`/projects/${selectedProject.id}/pair-codes/create`} method="post" className="row">
                <button className="button-primary" type="submit">Generate Pair Code</button>
              </form>
              {pairCode ? (
                <div className="row" style={{ marginTop: 10, alignItems: 'stretch' }}>
                  <div className="code" style={{ margin: 0, flex: 1 }}>
                    <div>Pair code: <strong>{pairCode}</strong></div>
                    {pairExpires ? <div style={{ marginTop: 6 }}>Expires: {new Date(pairExpires).toLocaleString()}</div> : null}
                  </div>
                  <CopyButton value={pairCode} redirectUrl={pairCopyRedirect} />
                </div>
              ) : null}
            </div>
          </div>

          <div className="card" style={{ background: 'var(--surface-soft)' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>4. Invite teammates</h3>
            <p className="muted" style={{ margin: '0 0 10px' }}>
              Share one link. Teammates sign in with GitHub and join automatically.
            </p>
            <form action={`/projects/${selectedProject.id}/invites/create`} method="post" className="row">
              <button className="button-primary" type="submit">Generate Invite Link</button>
            </form>
            {inviteUrl ? (
              <div className="row" style={{ marginTop: 10, alignItems: 'stretch' }}>
                <div className="code" style={{ margin: 0, flex: 1 }}>{inviteUrl}</div>
                <CopyButton value={inviteUrl} />
              </div>
            ) : null}
          </div>

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">Active workspace ID: {selectedProject.id}</span>
            <span className="muted">Tasks: {onboarding?.taskCount ?? 0}</span>
          </div>
        </section>
      ) : selectedProject ? (
        <section className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <h2 className="card-title" style={{ marginBottom: 4 }}>{selectedProject.name}</h2>
              <p className="subtitle" style={{ margin: 0 }}>
                Setup complete. Use workspace actions in the table below for sharing and setup utilities.
              </p>
            </div>
            <Link className="button-secondary" href={`/projects/${selectedProject.id}/tasks`}>Open Tasks</Link>
          </div>
        </section>
      ) : (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>No workspaces yet. Start with Step 1 above.</p>
        </section>
      )}

      {projects.length > 0 ? (
        <section className="card grid">
          <h2 className="card-title">All workspaces</h2>
          <p className="muted" style={{ margin: 0 }}>
            Open the actions menu for any workspace to connect Slack, generate pair codes, invite teammates, and open project pages.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id} className={project.id === selectedProject?.id ? 'workspace-row-active' : undefined}>
                  <td>{project.name}</td>
                  <td>{project.role}</td>
                  <td>{new Date(project.createdAt).toLocaleString()}</td>
                  <td>
                    <WorkspaceActionsMenu
                      projectId={project.id}
                      defaultOpen={keepMenuOpen && menuProjectId === project.id}
                      pairCode={project.id === selectedProject?.id ? pairCode : ''}
                      pairExpires={project.id === selectedProject?.id ? pairExpires : ''}
                      inviteUrl={project.id === selectedProject?.id ? inviteUrl : ''}
                      showGeneratedValues={project.id === selectedProject?.id}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </DashboardShell>
  );
}
