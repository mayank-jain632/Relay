'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STATUSES = ['todo', 'in_progress', 'blocked', 'review', 'done'] as const;
const KANBAN_COLUMNS: Array<{ key: TaskStatus; label: string }> = [
  { key: 'todo', label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'review', label: 'Review' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' }
];

type TaskStatus = (typeof STATUSES)[number];

interface MemberItem {
  userId: string;
  login: string;
  name?: string | null;
  role?: string;
  avatarUrl?: string | null;
}

interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: string;
  assignee_id?: string | null;
  assignedToUserId?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  source?: string | null;
}

interface TaskEvent {
  id: string | number;
  eventType: string;
  summary: string;
  createdAt?: string | null;
  actor?: {
    userId?: string | null;
    label?: string | null;
    login?: string | null;
    name?: string | null;
    avatarUrl?: string | null;
  } | null;
}

interface TasksBoardProps {
  projectId: string;
  tasks: TaskItem[];
  members: MemberItem[];
  currentLogin: string;
  initialOnlyMine?: boolean;
}

function formatStatus(status: string): string {
  return String(status || 'todo')
    .replace('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function nextStatus(current: string): TaskStatus {
  const normalized = String(current || 'todo').toLowerCase() as TaskStatus;
  const index = STATUSES.indexOf(normalized);
  if (index < 0) {
    return 'in_progress';
  }

  return STATUSES[(index + 1) % STATUSES.length];
}

function parseErrorMessage(data: any, fallback: string): string {
  if (data?.error) {
    return String(data.error);
  }

  if (data?.message) {
    return String(data.message);
  }

  return fallback;
}

function getEmptyColumnText(columnLabel: string, hasAnyShownTasks: boolean): string {
  if (!hasAnyShownTasks) {
    return 'No tasks yet. Drag a card here.';
  }

  return `No tasks in ${columnLabel}. Move one here when ready.`;
}

export function TasksBoard({
  projectId,
  tasks,
  members,
  currentLogin,
  initialOnlyMine = false
}: TasksBoardProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const memberById = useMemo(() => {
    const map = new Map<string, MemberItem>();
    members.forEach((member) => map.set(member.userId, member));
    return map;
  }, [members]);

  const [boardTasks, setBoardTasks] = useState<TaskItem[]>(tasks);
  const [query, setQuery] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [onlyMine, setOnlyMine] = useState(initialOnlyMine);
  const [showCreate, setShowCreate] = useState(tasks.length === 0);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [eventsByTaskId, setEventsByTaskId] = useState<Record<string, TaskEvent[]>>({});
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState('');

  useEffect(() => {
    setBoardTasks(tasks);
    if (!tasks.length) {
      setShowCreate(true);
    }
  }, [tasks]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const getTaskOwnerLogin = useCallback((task: TaskItem): string => {
    if (task.assignee_id) {
      return String(task.assignee_id);
    }

    if (task.assignedToUserId && memberById.has(task.assignedToUserId)) {
      return String(memberById.get(task.assignedToUserId)?.login || '');
    }

    return '';
  }, [memberById]);

  const filteredTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedMine = String(currentLogin || '').toLowerCase();

    return boardTasks.filter((task) => {
      const ownerLogin = getTaskOwnerLogin(task).toLowerCase();
      const haystack = `${task.title || ''} ${task.description || ''} ${ownerLogin}`.toLowerCase();

      if (normalizedQuery && !haystack.includes(normalizedQuery)) {
        return false;
      }

      if (onlyMine && ownerLogin !== normalizedMine) {
        return false;
      }

      if (statusFilter !== 'all' && task.status !== statusFilter) {
        return false;
      }

      if (assigneeFilter === 'unassigned' && (task.assignedToUserId || ownerLogin)) {
        return false;
      }

      if (assigneeFilter.startsWith('member:')) {
        const memberId = assigneeFilter.replace('member:', '');
        if (task.assignedToUserId !== memberId) {
          return false;
        }
      }

      if (assigneeFilter.startsWith('login:')) {
        const login = assigneeFilter.replace('login:', '');
        if (ownerLogin !== login.toLowerCase()) {
          return false;
        }
      }

      return true;
    });
  }, [query, currentLogin, boardTasks, statusFilter, assigneeFilter, onlyMine, getTaskOwnerLogin]);

  const tasksByStatus = useMemo(() => {
    const result: Record<string, TaskItem[]> = {};
    KANBAN_COLUMNS.forEach((column) => {
      result[column.key] = [];
    });

    filteredTasks.forEach((task) => {
      const key = KANBAN_COLUMNS.some((column) => column.key === task.status) ? task.status : 'todo';
      result[key].push(task);
    });

    return result;
  }, [filteredTasks]);

  const selectedTask = selectedTaskId ? boardTasks.find((task) => task.id === selectedTaskId) || null : null;

  const uniqueUnknownAssignees = useMemo(() => {
    const known = new Set(members.map((member) => member.login.toLowerCase()));
    const unknown = new Set<string>();
    boardTasks.forEach((task) => {
      const owner = String(task.assignee_id || '').trim();
      if (owner && !known.has(owner.toLowerCase())) {
        unknown.add(owner);
      }
    });
    return Array.from(unknown).sort((a, b) => a.localeCompare(b));
  }, [members, boardTasks]);

  const totalShown = filteredTasks.length;

  const fetchTaskEvents = useCallback(async (taskId: string) => {
    setEventsLoading(true);
    setEventsError('');
    try {
      const response = await fetch(`/projects/${projectId}/tasks/${taskId}/events`, {
        method: 'GET',
        cache: 'no-store'
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.ok) {
        throw new Error(parseErrorMessage(data, 'Failed to load task activity'));
      }

      setEventsByTaskId((previous) => ({
        ...previous,
        [taskId]: Array.isArray(data.events) ? data.events : []
      }));
    } catch (error) {
      setEventsError(String(error instanceof Error ? error.message : error));
    } finally {
      setEventsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }

    void fetchTaskEvents(selectedTaskId);
  }, [selectedTaskId, fetchTaskEvents]);

  const updateTaskOptimistic = useCallback(async (
    taskId: string,
    optimisticPatch: Partial<TaskItem>,
    serverPatch: Record<string, unknown>
  ) => {
    const previousTask = boardTasks.find((task) => task.id === taskId);
    if (!previousTask) {
      return false;
    }

    setActionError('');
    setBusyTaskId(taskId);

    setBoardTasks((previous) => previous.map((task) => (
      task.id === taskId
        ? {
            ...task,
            ...optimisticPatch,
            updatedAt: new Date().toISOString()
          }
        : task
    )));

    try {
      const response = await fetch(`/projects/${projectId}/tasks/${taskId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serverPatch)
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(parseErrorMessage(data, 'Failed to update task'));
      }

      if (data?.task) {
        setBoardTasks((previous) => previous.map((task) => (
          task.id === taskId ? { ...task, ...data.task } : task
        )));
      }

      if (data?.warning) {
        setActionError(String(data.warning));
      }

      if (selectedTaskId === taskId) {
        void fetchTaskEvents(taskId);
      }

      return true;
    } catch (error) {
      setBoardTasks((previous) => previous.map((task) => (
        task.id === taskId ? previousTask : task
      )));
      setActionError(String(error instanceof Error ? error.message : error));
      return false;
    } finally {
      setBusyTaskId((current) => (current === taskId ? null : current));
    }
  }, [boardTasks, projectId, selectedTaskId, fetchTaskEvents]);

  const currentEvents = selectedTaskId ? (eventsByTaskId[selectedTaskId] || []) : [];

  return (
    <>
      {actionError ? <div className="error">{actionError}</div> : null}

      <section className="card grid">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="card-title" style={{ margin: 0 }}>Quick filters</h2>
          <span className="muted">Showing {totalShown} of {boardTasks.length}</span>
        </div>

        <div className="quick-filter-row">
          <input
            ref={searchRef}
            className="input"
            type="search"
            value={query}
            placeholder="Search tasks (⌘K)"
            onChange={(event) => setQuery(event.target.value)}
          />

          <select className="select" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
            <option value="all">Assignee: anyone</option>
            <option value="unassigned">Assignee: unassigned</option>
            {members.map((member) => (
              <option key={member.userId} value={`member:${member.userId}`}>
                Assignee: {member.login}
              </option>
            ))}
            {uniqueUnknownAssignees.map((login) => (
              <option key={login} value={`login:${login}`}>
                Assignee: {login}
              </option>
            ))}
          </select>

          <select className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Status: all</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>Status: {formatStatus(status)}</option>
            ))}
          </select>

          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(event) => setOnlyMine(event.target.checked)}
            />
            Only mine
          </label>

          <button
            className="button-secondary"
            type="button"
            onClick={() => {
              setQuery('');
              setAssigneeFilter('all');
              setStatusFilter('all');
              setOnlyMine(initialOnlyMine);
            }}
          >
            Reset
          </button>
        </div>
      </section>

      <section className="card grid">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="card-title" style={{ margin: 0 }}>Create task</h2>
          {boardTasks.length > 0 ? (
            <button className="button-primary" type="button" onClick={() => setShowCreate((value) => !value)}>
              {showCreate ? 'Hide form' : '+ New task'}
            </button>
          ) : null}
        </div>

        {showCreate ? (
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
        ) : (
          <p className="muted" style={{ margin: 0 }}>New task form is collapsed so the board stays focused. Click + New task when needed.</p>
        )}
      </section>

      <section className="card grid">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="card-title" style={{ margin: 0 }}>Kanban Board</h2>
          <span className="muted">Card click opens full editor</span>
        </div>

        <div className="kanban-board" role="list">
          {KANBAN_COLUMNS.map((column) => {
            const columnTasks = tasksByStatus[column.key] || [];
            const emptyText = getEmptyColumnText(column.label, filteredTasks.length > 0);

            return (
              <section key={column.key} className="kanban-column" aria-label={column.label}>
                <header className="kanban-column-header">
                  <h3>{column.label}</h3>
                  <span>{columnTasks.length}</span>
                </header>

                <div className="kanban-column-body">
                  {columnTasks.map((task) => {
                    const ownerLogin = getTaskOwnerLogin(task) || 'Unassigned';
                    const ownerInitial = ownerLogin[0] ? ownerLogin[0].toUpperCase() : '?';
                    const isBusy = busyTaskId === task.id;

                    return (
                      <article
                        key={task.id}
                        className="task-card task-card-clickable"
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedTaskId(task.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedTaskId(task.id);
                          }
                        }}
                      >
                        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <strong style={{ fontSize: 14, lineHeight: 1.35 }}>{task.title}</strong>
                          <button
                            className={`badge badge-button ${task.status}`}
                            type="button"
                            disabled={isBusy}
                            title="Click to move to next status"
                            onClick={(event) => {
                              event.stopPropagation();
                              const next = nextStatus(task.status);
                              void updateTaskOptimistic(
                                task.id,
                                { status: next },
                                { status: next }
                              );
                            }}
                          >
                            {formatStatus(task.status)}
                          </button>
                        </div>

                        {task.description ? (
                          <p className="muted" style={{ margin: 0, lineHeight: 1.4 }}>
                            {task.description.length > 120 ? `${task.description.slice(0, 120)}...` : task.description}
                          </p>
                        ) : null}

                        <div className="task-meta-row" onClick={(event) => event.stopPropagation()}>
                          <div className="owner-chip" title={ownerLogin}>{ownerInitial}</div>
                          <select
                            key={`${task.id}-${task.assignedToUserId || '__none__'}`}
                            className="select select-compact owner-select"
                            name="assignedToUserId"
                            defaultValue={task.assignedToUserId || '__none__'}
                            disabled={isBusy}
                            onChange={(event) => {
                              const selectedUserId = event.currentTarget.value;
                              const assignedToUserId = selectedUserId === '__none__' ? null : selectedUserId;
                              const member = assignedToUserId ? memberById.get(assignedToUserId) : null;

                              void updateTaskOptimistic(
                                task.id,
                                {
                                  assignedToUserId,
                                  assignee_id: member?.login || null
                                },
                                {
                                  assignedToUserId
                                }
                              );
                            }}
                          >
                            <option value="__none__">Unassigned</option>
                            {members.map((member) => (
                              <option key={member.userId} value={member.userId}>
                                {member.login}
                              </option>
                            ))}
                          </select>
                          <span className="muted" style={{ marginLeft: 'auto' }}>{formatDate(task.updatedAt)}</span>
                        </div>
                      </article>
                    );
                  })}

                  {columnTasks.length === 0 ? (
                    <div className="kanban-empty">{emptyText}</div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </section>

      {selectedTask ? (
        <div className="task-drawer-overlay" onClick={() => setSelectedTaskId(null)}>
          <aside className="task-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>Edit task</h3>
              <button className="button-secondary" type="button" onClick={() => setSelectedTaskId(null)}>Close</button>
            </div>

            <form
              className="grid"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!selectedTask) {
                  return;
                }

                const formData = new FormData(event.currentTarget);
                const status = String(formData.get('status') || selectedTask.status).trim().toLowerCase();
                const title = String(formData.get('title') || selectedTask.title).trim();
                const description = String(formData.get('description') || selectedTask.description || '');
                const assignedRaw = String(formData.get('assignedToUserId') || '').trim();
                const assignedToUserId = assignedRaw === '__none__' ? null : assignedRaw;
                const member = assignedToUserId ? memberById.get(assignedToUserId) : null;

                const ok = await updateTaskOptimistic(
                  selectedTask.id,
                  {
                    status,
                    title: title || selectedTask.title,
                    description,
                    assignedToUserId,
                    assignee_id: member?.login || null
                  },
                  {
                    status,
                    title: title || selectedTask.title,
                    description,
                    assignedToUserId
                  }
                );

                if (ok) {
                  setSelectedTaskId(null);
                }
              }}
            >
              <input className="input" type="text" name="title" defaultValue={selectedTask.title || ''} required />
              <textarea className="textarea" name="description" defaultValue={selectedTask.description || ''} />
              <div className="row">
                <select className="select" name="status" defaultValue={selectedTask.status || 'todo'}>
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>{formatStatus(status)}</option>
                  ))}
                </select>
                <select className="select" name="assignedToUserId" defaultValue={selectedTask.assignedToUserId || '__none__'}>
                  <option value="__none__">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>{member.login}</option>
                  ))}
                </select>
              </div>

              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted">Last updated: {formatDate(selectedTask.updatedAt)}</span>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={busyTaskId === selectedTask.id}
                    onClick={() => {
                      const confirmed = window.confirm('Delete this task? This cannot be undone.');
                      if (!confirmed) {
                        return;
                      }

                      const form = document.createElement('form');
                      form.method = 'POST';
                      form.action = `/projects/${projectId}/tasks/${selectedTask.id}/delete`;
                      document.body.appendChild(form);
                      form.submit();
                    }}
                  >
                    Delete Task
                  </button>
                  <button className="button-primary" type="submit" disabled={busyTaskId === selectedTask.id}>Save changes</button>
                </div>
              </div>
            </form>

            <section className="task-activity">
              <h4 style={{ margin: 0 }}>Activity</h4>
              {eventsLoading ? <p className="muted" style={{ margin: 0 }}>Loading activity…</p> : null}
              {eventsError ? <div className="error">{eventsError}</div> : null}

              {!eventsLoading && !eventsError && currentEvents.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>No activity yet.</p>
              ) : null}

              <div className="task-activity-list">
                {currentEvents.map((eventItem) => (
                  <div key={`${eventItem.id}`} className="task-activity-item">
                    <div>{eventItem.summary}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {(eventItem.actor?.name || eventItem.actor?.login || eventItem.actor?.label || 'System')} · {formatDate(eventItem.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      ) : null}
    </>
  );
}
