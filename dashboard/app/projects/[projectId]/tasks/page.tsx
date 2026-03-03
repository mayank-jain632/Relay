import Link from 'next/link';
import { requireDashboardSession } from '@/lib/auth';
import { relayGet } from '@/lib/relay-api';
import { DashboardShell } from '@/components/DashboardShell';
import { TasksBoard } from '@/components/TasksBoard';

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

  return (
    <DashboardShell
      title="Team Tasks"
      subtitle="Run planning and execution from one board with quick actions and focused editing."
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

      <TasksBoard
        projectId={projectId}
        tasks={tasks}
        members={members}
        currentLogin={session.user.login}
        initialOnlyMine={assigned === 'me'}
      />
    </DashboardShell>
  );
}
