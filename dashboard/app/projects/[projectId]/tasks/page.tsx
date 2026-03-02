import Link from 'next/link';
import { requireDashboardSession } from '@/lib/auth';
import { relayGet } from '@/lib/relay-api';
import { DashboardShell } from '@/components/DashboardShell';

const STATUSES = ['todo', 'in_progress', 'blocked', 'review', 'done'] as const;

const KANBAN_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'todo', label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'review', label: 'Review' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' }
];

function badgeClass(status: string): string {
  return `badge ${status}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
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
  let projectName = projectId;
  let error = '';

  try {
    const [tasksData, membersData, projectsData] = await Promise.all([
      relayGet(`/projects/${encodeURIComponent(projectId)}/tasks?assigned=${assigned}&view=list`, session.token),
      relayGet(`/projects/${encodeURIComponent(projectId)}/members`, session.token),
      relayGet('/projects', session.token)
    ]);

    tasks = Array.isArray(tasksData?.tasks) ? tasksData.tasks : [];
    members = Array.isArray(membersData?.members) ? membersData.members : [];

    const projects = Array.isArray(projectsData?.projects) ? projectsData.projects : [];
    const active = projects.find((project: any) => project.id === projectId);
    if (active?.name) {
      projectName = active.name;
    }
  } catch (err) {
    error = String(err instanceof Error ? err.message : err);
  }

  const tasksByStatus = KANBAN_COLUMNS.reduce<Record<string, any[]>>((acc, column) => {
    acc[column.key] = [];
    return acc;
  }, {});

  for (const task of tasks) {
    const status = typeof task?.status === 'string' ? task.status : 'todo';
    if (!tasksByStatus[status]) {
      tasksByStatus.todo.push(task);
      continue;
    }
    tasksByStatus[status].push(task);
  }

  return (
    <DashboardShell
      title="Team Tasks"
      subtitle="Create tasks, assign owners, and track progress."
      activeNav="tasks"
      projectId={projectId}
      activeProjectName={projectName}
      sessionLogin={session.user.login}
      sessionName={session.user.name}
      actions={(
        <>
          <Link className="button-secondary" href={`/projects/${projectId}/tasks?assigned=me`}>My Tasks</Link>
          <Link className="button-secondary" href={`/projects/${projectId}/tasks?assigned=all`}>All Tasks</Link>
        </>
      )}
    >
      {searchParams.created ? <div className="notice">Task created.</div> : null}
      {searchParams.updated ? <div className="notice">Task updated.</div> : null}
      {searchParams.error ? <div className="error">{String(searchParams.error)}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="card grid">
        <h2 className="card-title">Create a task</h2>
        <p className="muted" style={{ margin: 0 }}>Keep it short and clear so the assignee knows exactly what to do.</p>
        <form className="grid" action={`/projects/${projectId}/tasks/create`} method="post">
          <input className="input" type="text" name="title" placeholder="Example: Update onboarding checklist" required />
          <textarea className="textarea" name="description" placeholder="Add details, success criteria, or notes" />
          <div className="row">
            <select className="select" name="assigneeUserId" defaultValue="">
              <option value="">Assign later</option>
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
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="card-title" style={{ margin: 0 }}>Kanban Board</h2>
          <span className="muted">{tasks.length} total tasks</span>
        </div>

        <div className="kanban-board" role="list">
          {KANBAN_COLUMNS.map((column) => {
            const columnTasks = tasksByStatus[column.key] || [];
            return (
              <section key={column.key} className="kanban-column" aria-label={column.label}>
                <header className="kanban-column-header">
                  <h3>{column.label}</h3>
                  <span>{columnTasks.length}</span>
                </header>

                <div className="kanban-column-body">
                  {columnTasks.map((task) => (
                    <article key={task.id} className="task-card" role="listitem">
                      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <strong style={{ fontSize: 14, lineHeight: 1.35 }}>{task.title}</strong>
                        <span className={badgeClass(task.status)}>{String(task.status).replace('_', ' ')}</span>
                      </div>

                      {task.description ? (
                        <p className="muted" style={{ margin: 0 }}>{task.description}</p>
                      ) : null}

                      <div className="task-meta">
                        <span>Owner: {task.assignee_id || 'Unassigned'}</span>
                        <span>Updated: {formatDate(task.updatedAt)}</span>
                      </div>

                      <form className="task-edit-form" action={`/projects/${projectId}/tasks/${task.id}/patch`} method="post">
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
                    </article>
                  ))}

                  {columnTasks.length === 0 ? (
                    <div className="kanban-empty">No tasks in this column.</div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </DashboardShell>
  );
}
