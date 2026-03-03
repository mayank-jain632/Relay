'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CopyButton } from '@/components/CopyButton';

interface WorkspaceActionsMenuProps {
  projectId: string;
  defaultOpen?: boolean;
  pairCode?: string;
  pairExpires?: string;
  inviteUrl?: string;
  showGeneratedValues?: boolean;
}

export function WorkspaceActionsMenu({
  projectId,
  defaultOpen = false,
  pairCode,
  pairExpires,
  inviteUrl,
  showGeneratedValues = false
}: WorkspaceActionsMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(defaultOpen);

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

  const pairCopyRedirect = useMemo(
    () => `/projects?project=${encodeURIComponent(projectId)}&extension_copied=1`,
    [projectId]
  );

  return (
    <div ref={rootRef} className={`workspace-actions-menu${open ? ' open' : ''}`}>
      <button
        type="button"
        className="button-secondary workspace-actions-summary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Actions
      </button>

      {open ? (
        <div className="workspace-actions-panel" role="menu" aria-label="Workspace actions">
          <div className="workspace-actions-grid">
            <Link className="button-secondary" href={`/projects?project=${projectId}`}>Set Active</Link>
            <Link className="button-secondary" href={`/projects/${projectId}/tasks`}>Open Tasks</Link>
            <Link className="button-secondary" href={`/projects/${projectId}/integrations/slack`}>Slack Settings</Link>

            <form action={`/projects/${projectId}/integrations/slack/connect`} method="post">
              <button className="button-secondary" type="submit">Connect Slack</button>
            </form>
            <form action={`/projects/${projectId}/pair-codes/create`} method="post">
              <input type="hidden" name="menu_project" value={projectId} />
              <button className="button-secondary" type="submit">Generate Pair Code</button>
            </form>
            <form action={`/projects/${projectId}/invites/create`} method="post">
              <input type="hidden" name="menu_project" value={projectId} />
              <button className="button-secondary" type="submit">Generate Invite Link</button>
            </form>
          </div>

          {showGeneratedValues && pairCode ? (
            <div className="workspace-actions-inline">
              <div className="code workspace-actions-code">
                <div>Pair code: <strong>{pairCode}</strong></div>
                {pairExpires ? <div style={{ marginTop: 6 }}>Expires: {new Date(pairExpires).toLocaleString()}</div> : null}
              </div>
              <CopyButton value={pairCode} redirectUrl={pairCopyRedirect} />
            </div>
          ) : null}

          {showGeneratedValues && inviteUrl ? (
            <div className="workspace-actions-inline">
              <div className="code workspace-actions-code">{inviteUrl}</div>
              <CopyButton value={inviteUrl} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
