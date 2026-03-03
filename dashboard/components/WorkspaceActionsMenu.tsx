'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CopyButton } from '@/components/CopyButton';

interface OnboardingState {
  workspaceCreated: boolean;
  slackConnected: boolean;
  extensionLinked: boolean;
  firstTaskCreated: boolean;
  lastSlackEventAt?: string | null;
  taskCount?: number;
}

interface WorkspaceActionsMenuProps {
  projectId: string;
  projectName: string;
  projectRole: string;
  onboarding?: OnboardingState | null;
  defaultOpen?: boolean;
  pairCode?: string;
  pairExpires?: string;
  inviteUrl?: string;
  showGeneratedValues?: boolean;
}

export function WorkspaceActionsMenu({
  projectId,
  projectName,
  projectRole,
  onboarding,
  defaultOpen = false,
  pairCode,
  pairExpires,
  inviteUrl,
  showGeneratedValues = false
}: WorkspaceActionsMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [extensionCopied, setExtensionCopied] = useState(false);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) {
        return;
      }

      const target = event.target as Node;
      if (!rootRef.current.contains(target)) {
        setOpen(false);
      }
    };

    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onEsc);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const extensionDone = Boolean(onboarding?.extensionLinked || extensionCopied);
  const checklist = [
    { label: 'Workspace created', done: Boolean(onboarding?.workspaceCreated) },
    { label: 'Slack connected', done: Boolean(onboarding?.slackConnected) },
    { label: 'Extension linked', done: extensionDone }
  ];

  return (
    <div ref={rootRef} className={`workspace-actions-menu${open ? ' open' : ''}`}>
      <button
        type="button"
        className="button-secondary workspace-actions-summary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Setup & Share
      </button>

      {open ? (
        <div className="workspace-actions-panel workspace-actions-panel-full" role="menu" aria-label={`Setup actions for ${projectName}`}>
          <div className="workspace-actions-header">
            <div>
              <div className="workspace-actions-title">{projectName}</div>
              <div className="workspace-actions-meta">Role: {projectRole}</div>
            </div>
            <div className="workspace-actions-inline-buttons">
              <Link className="button-secondary" href={`/projects/${projectId}/integrations/slack`}>Slack</Link>
              <Link className="button-secondary" href={`/projects/${projectId}/tasks`}>Tasks</Link>
            </div>
          </div>

          <div className="workspace-actions-checklist">
            {checklist.map((item) => (
              <div key={item.label} className="workspace-actions-check-row">
                <span>{item.label}</span>
                <span className={item.done ? 'badge done' : 'badge todo'}>{item.done ? 'Done' : 'Pending'}</span>
              </div>
            ))}
          </div>

          <div className="workspace-actions-sections">
            <div className="workspace-actions-section-card">
              <h4>Connect Slack</h4>
              <p className="muted" style={{ margin: '0 0 10px' }}>Install Relay app and sync this workspace.</p>
              <form action={`/projects/${projectId}/integrations/slack/connect`} method="post">
                <button className="button-secondary" type="submit">Connect Slack</button>
              </form>
              <p className="muted" style={{ margin: '10px 0 0' }}>
                Status: {onboarding?.slackConnected ? 'Connected' : 'Not connected'}
                {onboarding?.lastSlackEventAt ? ` · Last event ${new Date(onboarding.lastSlackEventAt).toLocaleString()}` : ''}
              </p>
            </div>

            <div className="workspace-actions-section-card">
              <h4>Install extension</h4>
              <p className="muted" style={{ margin: '0 0 10px' }}>Generate a pair code, then copy it into VS Code.</p>
              <form action={`/projects/${projectId}/pair-codes/create`} method="post" className="row">
                <input type="hidden" name="menu_project" value={projectId} />
                <button className="button-secondary" type="submit">Generate Pair Code</button>
              </form>

              {showGeneratedValues && pairCode ? (
                <div className="workspace-actions-inline" style={{ marginTop: 10 }}>
                  <div className="code workspace-actions-code">
                    <div>Pair code: <strong>{pairCode}</strong></div>
                    {pairExpires ? <div style={{ marginTop: 6 }}>Expires: {new Date(pairExpires).toLocaleString()}</div> : null}
                  </div>
                  <CopyButton value={pairCode} onCopied={() => setExtensionCopied(true)} />
                </div>
              ) : null}
            </div>

            <div className="workspace-actions-section-card">
              <h4>Invite teammates</h4>
              <p className="muted" style={{ margin: '0 0 10px' }}>Generate a join link and share it.</p>
              <form action={`/projects/${projectId}/invites/create`} method="post" className="row">
                <input type="hidden" name="menu_project" value={projectId} />
                <button className="button-secondary" type="submit">Generate Invite Link</button>
              </form>

              {showGeneratedValues && inviteUrl ? (
                <div className="workspace-actions-inline" style={{ marginTop: 10 }}>
                  <div className="code workspace-actions-code">{inviteUrl}</div>
                  <CopyButton value={inviteUrl} />
                </div>
              ) : null}
            </div>
          </div>

          <div className="workspace-actions-footer muted">
            Workspace ID: {projectId} · Tasks: {onboarding?.taskCount ?? 0}
          </div>
        </div>
      ) : null}
    </div>
  );
}
