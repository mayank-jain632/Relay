import Link from 'next/link';
import { requireDashboardSession } from '@/lib/auth';
import { getAdminApiKey, getApiBaseUrl } from '@/lib/config';
import { relayGet } from '@/lib/relay-api';
import { DashboardShell } from '@/components/DashboardShell';

interface ProjectItem {
  id: string;
  name: string;
  role: string;
  createdAt: string;
}

function configSnippet(apiBaseUrl: string, projectId: string): string {
  return JSON.stringify(
    {
      apiBaseUrl,
      projectId,
      baseBranch: 'main'
    },
    null,
    2
  );
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
    return 'Project creation is restricted. Ask an admin to set DASHBOARD_ADMIN_API_KEY in dashboard/.env and restart the dashboard.';
  }

  return String(raw);
}

export default async function ProjectsPage({
  searchParams
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const session = await requireDashboardSession();

  let projects: ProjectItem[] = [];
  let error = '';

  try {
    const data = await relayGet('/projects', session.token);
    projects = Array.isArray(data?.projects) ? data.projects : [];
  } catch (err) {
    error = String(err instanceof Error ? err.message : err);
  }

  const apiBaseUrl = getApiBaseUrl();
  const hasAdminKey = Boolean(getAdminApiKey());

  const projectParam = typeof searchParams.project === 'string' ? searchParams.project : '';
  const selectedProject = projects.find((project) => project.id === projectParam) ?? projects[0];
  const navProjectId = selectedProject?.id;
  const uiError = renderError(searchParams.error);

  return (
    <DashboardShell
      title="Team Setup"
      subtitle="Create a workspace, connect Slack, and start assigning work in three steps."
      activeNav="projects"
      projectId={navProjectId}
      activeProjectName={selectedProject?.name}
      sessionLogin={session.user.login}
      sessionName={session.user.name}
      actions={navProjectId ? (
        <>
          <Link className="button-secondary" href={`/projects/${navProjectId}/integrations/slack`}>Step 2: Connect Slack</Link>
          <Link className="button-secondary" href={`/projects/${navProjectId}/tasks`}>Step 3: Manage Tasks</Link>
        </>
      ) : null}
    >
      {searchParams.created ? <div className="notice">Workspace created. Next, connect Slack.</div> : null}
      {searchParams.member_added ? <div className="notice">Teammate added.</div> : null}
      {uiError ? <div className="error">{uiError}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      {!hasAdminKey ? (
        <section className="notice">
          <strong>Setup note:</strong> If your API requires admin approval for creating workspaces, add
          {' '}<code>DASHBOARD_ADMIN_API_KEY</code>{' '}in <code>dashboard/.env</code>.
        </section>
      ) : null}

      <section className="card grid">
        <h2 className="card-title">How this works</h2>
        <ol className="muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
          <li>Create a workspace for your team.</li>
          <li>Connect Slack and map teammates.</li>
          <li>Create tasks and assign owners.</li>
        </ol>
      </section>

      <section className="card grid">
        <h2 className="card-title">Step 1: Create a workspace</h2>
        <p className="muted" style={{ margin: 0 }}>Use a simple team name like “Relay Product Team”.</p>
        <form action="/projects/create" method="post" className="row">
          <input className="input" type="text" name="name" placeholder="Relay Product Team" required style={{ minWidth: 320 }} />
          <button className="button-primary" type="submit">Create Workspace</button>
        </form>
      </section>

      {projects.map((project) => (
        <section className="card grid" key={project.id}>
          <div className="header" style={{ marginBottom: 0 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 17 }}>{project.name}</h3>
              <p className="subtitle">Role: {project.role}</p>
            </div>
            <div className="row">
              <Link className="button-secondary" href={`/projects?project=${project.id}`}>Set as Active</Link>
              <Link className="button-secondary" href={`/projects/${project.id}/integrations/slack`}>Step 2: Slack</Link>
              <Link className="button-secondary" href={`/projects/${project.id}/tasks`}>Step 3: Tasks</Link>
            </div>
          </div>

          <div className="grid two-col">
            <div>
              <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>Invite teammate</h4>
              <p className="muted" style={{ margin: '0 0 8px' }}>Enter their GitHub username.</p>
              <form action={`/projects/${project.id}/members/add`} method="post" className="grid" style={{ gap: 8 }}>
                <input className="input" type="text" name="githubLogin" placeholder="github username" required />
                <select className="select" name="role" defaultValue="member">
                  <option value="member">Team member</option>
                  <option value="owner">Workspace owner</option>
                </select>
                <button className="button-primary" type="submit">Add Teammate</button>
              </form>
            </div>
            <div>
              <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>Advanced setup (engineering only)</h4>
              <p className="muted" style={{ margin: '0 0 8px' }}>Share this with a developer to link the VS Code extension.</p>
              <pre className="code">{configSnippet(apiBaseUrl, project.id)}</pre>
            </div>
          </div>
        </section>
      ))}

      {projects.length === 0 ? (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>No workspaces yet. Start with “Step 1: Create a workspace”.</p>
        </section>
      ) : null}
    </DashboardShell>
  );
}
