import Link from 'next/link';
import type { ReactNode } from 'react';

type NavKey = 'projects' | 'slack' | 'tasks';

interface DashboardShellProps {
  title: string;
  subtitle?: string;
  sessionLogin: string;
  sessionName?: string | null;
  activeNav: NavKey;
  projectId?: string;
  activeProjectName?: string;
  actions?: ReactNode;
  children: ReactNode;
}

function navHref(key: NavKey, projectId?: string): string {
  if (key === 'projects') {
    return '/projects';
  }

  if (!projectId) {
    return '/projects';
  }

  if (key === 'slack') {
    return `/projects/${projectId}/integrations/slack`;
  }

  return `/projects/${projectId}/tasks`;
}

function navLabel(key: NavKey): string {
  if (key === 'projects') {
    return 'Projects';
  }

  if (key === 'slack') {
    return 'Slack';
  }

  return 'Tasks';
}

function navHint(key: NavKey): string {
  if (key === 'projects') {
    return 'Onboarding and members';
  }

  if (key === 'slack') {
    return 'Events and mapping';
  }

  return 'Create and assign work';
}

export function DashboardShell({
  title,
  subtitle,
  sessionLogin,
  sessionName,
  activeNav,
  projectId,
  activeProjectName,
  actions,
  children
}: DashboardShellProps) {
  const navItems: NavKey[] = ['projects', 'slack', 'tasks'];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-dot" />
          <div>
            <div className="sidebar-brand-title">Relay</div>
            <div className="sidebar-brand-subtitle">Control Panel</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Dashboard navigation">
          {navItems.map((key) => {
            const active = key === activeNav;
            const href = navHref(key, projectId);
            const disabled = (key === 'slack' || key === 'tasks') && !projectId;

            if (disabled) {
              return (
                <div key={key} className="nav-link nav-link-disabled" aria-disabled="true">
                  <div className="nav-link-label">{navLabel(key)}</div>
                  <div className="nav-link-hint">Create/select a project first</div>
                </div>
              );
            }

            return (
              <Link key={key} href={href} className={`nav-link${active ? ' nav-link-active' : ''}`}>
                <div className="nav-link-label">{navLabel(key)}</div>
                <div className="nav-link-hint">{navHint(key)}</div>
              </Link>
            );
          })}
        </nav>

        <div className="active-project-card" aria-live="polite">
          <div className="active-project-label">Active project</div>
          <div className="active-project-value">{activeProjectName || 'None selected'}</div>
        </div>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-name">{sessionName || sessionLogin}</div>
            <div className="user-login">@{sessionLogin}</div>
          </div>
          <form action="/logout" method="post">
            <button className="button-secondary" type="submit">Logout</button>
          </form>
        </div>
      </aside>

      <section className="content">
        <header className="header">
          <div>
            <h1 className="title">{title}</h1>
            {subtitle ? <p className="subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="row">{actions}</div> : null}
        </header>

        <div className="grid">{children}</div>
      </section>
    </main>
  );
}
