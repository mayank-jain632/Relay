import Link from 'next/link';
import { requireDashboardSession } from '@/lib/auth';
import { relayGet } from '@/lib/relay-api';
import { DashboardShell } from '@/components/DashboardShell';
import { WorkspaceActionsMenu } from '@/components/WorkspaceActionsMenu';
import { getActiveProjectId } from '@/lib/session';

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

export default async function ProjectsPage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await requireDashboardSession();
  const resolvedSearchParams = await searchParams;

  let projects: ProjectItem[] = [];
  let error = '';

  try {
    const data = await relayGet('/projects', session.token);
    projects = Array.isArray(data?.projects) ? data.projects : [];
  } catch (err) {
    error = String(err instanceof Error ? err.message : err);
  }

  const projectParam = typeof resolvedSearchParams.project === 'string' ? resolvedSearchParams.project : '';
  const activeProjectId = await getActiveProjectId();
  const selectedProject =
    projects.find((project) => project.id === projectParam) ||
    projects.find((project) => project.id === activeProjectId) ||
    projects[0];
  const navProjectId = selectedProject?.id;
  const uiError = renderError(resolvedSearchParams.error);

  const onboardingByProjectId: Record<string, OnboardingState | null> = {};
  if (projects.length > 0) {
    const entries = await Promise.all(
      projects.map(async (project) => {
        try {
          const data = await relayGet(`/projects/${encodeURIComponent(project.id)}/onboarding`, session.token);
          return [project.id, (data?.onboarding || null) as OnboardingState | null] as const;
        } catch {
          return [project.id, null] as const;
        }
      })
    );

    for (const [projectId, onboarding] of entries) {
      onboardingByProjectId[projectId] = onboarding;
    }
  }

  const pairCode = typeof resolvedSearchParams.pair_code === 'string' ? resolvedSearchParams.pair_code : '';
  const pairExpires = typeof resolvedSearchParams.pair_expires === 'string' ? resolvedSearchParams.pair_expires : '';
  const inviteUrl = typeof resolvedSearchParams.invite_url === 'string' ? resolvedSearchParams.invite_url : '';
  const keepMenuOpen = resolvedSearchParams.menu_open === '1';
  const menuProjectId = typeof resolvedSearchParams.menu_project === 'string' ? resolvedSearchParams.menu_project : '';

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
          <Link className="button-secondary" href={`/projects/select?project=${encodeURIComponent(navProjectId)}`}>Set Active</Link>
          <Link className="button-secondary" href={`/projects/${navProjectId}/integrations/slack`}>Slack</Link>
          <Link className="button-secondary" href={`/projects/${navProjectId}/tasks`}>Tasks</Link>
        </>
      ) : null}
    >
      {resolvedSearchParams.created ? <div className="notice">Workspace created. Continue setup from that workspace's Setup & Share dropdown.</div> : null}
      {resolvedSearchParams.connected ? <div className="notice">Slack connected successfully.</div> : null}
      {resolvedSearchParams.paired ? <div className="notice">Pair code generated.</div> : null}
      {resolvedSearchParams.invite_created ? <div className="notice">Invite link generated.</div> : null}
      {uiError ? <div className="error">{uiError}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="card grid">
        <h2 className="card-title">Create workspace</h2>
        <p className="muted" style={{ margin: 0 }}>Pick a simple team name. Example: Product Engineering.</p>
        <form action="/projects/create" method="post" className="row">
          <input className="input" type="text" name="name" placeholder="Product Engineering" required style={{ minWidth: 320 }} />
          <button className="button-primary" type="submit">Create Workspace</button>
        </form>
      </section>

      {projects.length > 0 ? (
        <section className="card grid">
          <h2 className="card-title">All workspaces</h2>
          <p className="muted" style={{ margin: 0 }}>
            Use Set Active for frequent switching. Open Setup & Share to manage pairing and invite links for that workspace.
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
                    <div className="row" style={{ gap: 6 }}>
                      <Link className="button-secondary" href={`/projects/select?project=${encodeURIComponent(project.id)}`}>Set Active</Link>
                      <WorkspaceActionsMenu
                        projectId={project.id}
                        projectName={project.name}
                        projectRole={project.role}
                        onboarding={onboardingByProjectId[project.id]}
                        defaultOpen={keepMenuOpen && menuProjectId === project.id}
                        pairCode={project.id === selectedProject?.id ? pairCode : ''}
                        pairExpires={project.id === selectedProject?.id ? pairExpires : ''}
                        inviteUrl={project.id === selectedProject?.id ? inviteUrl : ''}
                        showGeneratedValues={project.id === selectedProject?.id}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>No workspaces yet. Start by creating one above.</p>
        </section>
      )}
    </DashboardShell>
  );
}
