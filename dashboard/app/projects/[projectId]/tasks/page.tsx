import Link from 'next/link';
import { requireDashboardSession } from '@/lib/auth';
import { relayGet } from '@/lib/relay-api';

const STATUSES = ['todo', 'in_progress', 'blocked', 'review', 'done'];

function badgeClass(status: string): string {
  return `badge ${status}`;
}

export default async function TasksPage({
  params,
  searchParams
}: {
  params: { projectId: string };
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const session = await requireDashboardSession();
  const { projectId } = params;
  const assigned = searchParams.assigned === 'me' ? 'me' : 'all';

  let tasks: any[] = [];
  let members: any[] = [];
  let error = '';

  try {
    const [tasksData, membersData] = await Promise.all([
      relayGet(`/projects/${encodeURIComponent(projectId)}/tasks?assigned=${assigned}&view=list`, session.token),
      relayGet(`/projects/${encodeURIComponent(projectId)}/members`, session.token)
    ]);

    tasks = Array.isArray(tasksData?.tasks) ? tasksData.tasks : [];
    members = Array.isArray(membersData?.members) ? membersData.members : [];
  } catch (err) {
    error = String(err instanceof Error ? err.message : err);
  }

  return (
    <main className="page grid">
      <header className="header">
        <div>
          <h1 className="title">Tasks</h1>
          <p className="subtitle">Project {projectId}</p>
        </div>
        <div className="row">
          <Link className="button-secondary" href="/projects">Back</Link>
          <Link className="button-secondary" href={`/projects/${projectId}/integrations/slack`}>Slack</Link>
          <Link className="button-secondary" href={`/projects/${projectId}/tasks?assigned=me`}>My</Link>
          <Link className="button-secondary" href={`/projects/${projectId}/tasks?assigned=all`}>All</Link>
        </div>
      </header>

      {searchParams.created ? <div className="notice">Task created.</div> : null}
      {searchParams.updated ? <div className="notice">Task updated.</div> : null}
      {searchParams.error ? <div className="error">{String(searchParams.error)}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="card grid">
        <h2 style={{ margin: 0, fontSize: 18 }}>Create Task</h2>
        <form className="grid" action={`/projects/${projectId}/tasks/create`} method="post">
          <input className="input" type="text" name="title" placeholder="Task title" required />
          <textarea className="textarea" name="description" placeholder="Description" />
          <div className="row">
            <select className="select" name="assigneeUserId" defaultValue="">
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.login} ({member.role})
                </option>
              ))}
            </select>
            <button className="button-primary" type="submit">Create Task</button>
          </div>
        </form>
      </section>

      <section className="card grid">
        <h2 style={{ margin: 0, fontSize: 18 }}>Task List</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Assignee</th>
              <th>Updated</th>
              <th>Update</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>
                  <strong>{task.title}</strong>
                  <div className="muted">{task.description}</div>
                </td>
                <td><span className={badgeClass(task.status)}>{String(task.status).replace('_', ' ')}</span></td>
                <td>{task.assignee_id || 'Unassigned'}</td>
                <td>{task.updatedAt ? new Date(task.updatedAt).toLocaleString() : '-'}</td>
                <td>
                  <form className="row" action={`/projects/${projectId}/tasks/${task.id}/patch`} method="post">
                    <select className="select" name="status" defaultValue={task.status}>
                      {STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                    <select className="select" name="assignedToUserId" defaultValue={task.assignedToUserId || '__none__'}>
                      <option value="__none__">Unassigned</option>
                      {members.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.login}
                        </option>
                      ))}
                    </select>
                    <button className="button-primary" type="submit">Save</button>
                  </form>
                </td>
              </tr>
            ))}
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">No tasks found for this filter.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </main>
  );
}
