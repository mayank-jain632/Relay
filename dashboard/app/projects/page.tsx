import Link from 'next/link';
import { requireDashboardSession } from '@/lib/auth';
import { getApiBaseUrl } from '@/lib/config';
import { relayGet } from '@/lib/relay-api';

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

  return (
    <main className="page grid">
      <header className="header">
        <div>
          <h1 className="title">Relay Projects</h1>
          <p className="subtitle">Onboarding, membership, Slack setup, and task visibility.</p>
        </div>
        <div className="row">
          <span className="muted">Signed in as {session.user.login}</span>
          <Link className="button-secondary" href="/logout">Logout</Link>
        </div>
      </header>

      {searchParams.created ? <div className="notice">Project created.</div> : null}
      {searchParams.member_added ? <div className="notice">Member added.</div> : null}
      {searchParams.error ? <div className="error">{String(searchParams.error)}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="card grid">
        <h2 style={{ margin: 0, fontSize: 18 }}>Create Project</h2>
        <form action="/projects/create" method="post" className="row">
          <input className="input" type="text" name="name" placeholder="Relay Pilot" required style={{ minWidth: 280 }} />
          <button className="button-primary" type="submit">Create Project</button>
        </form>
      </section>

      {projects.map((project) => (
        <section className="card grid" key={project.id}>
          <div className="header" style={{ marginBottom: 0 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16 }}>{project.name}</h3>
              <p className="subtitle">ID: {project.id} · role: {project.role}</p>
            </div>
            <div className="row">
              <Link className="button-secondary" href={`/projects/${project.id}/tasks`}>Tasks</Link>
              <Link className="button-secondary" href={`/projects/${project.id}/integrations/slack`}>Slack</Link>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Repo config snippet</div>
              <pre className="code">{configSnippet(apiBaseUrl, project.id)}</pre>
            </div>
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Invite member</div>
              <form action={`/projects/${project.id}/members/add`} method="post" className="grid" style={{ gap: 8 }}>
                <input className="input" type="text" name="githubLogin" placeholder="github login" required />
                <select className="select" name="role" defaultValue="member">
                  <option value="member">member</option>
                  <option value="owner">owner</option>
                </select>
                <button className="button-primary" type="submit">Add Member</button>
              </form>
            </div>
          </div>
        </section>
      ))}

      {projects.length === 0 ? <section className="card"><p className="muted">No projects yet.</p></section> : null}
    </main>
  );
}
