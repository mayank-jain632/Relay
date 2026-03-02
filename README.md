# Relay

Relay is a Slack-to-IDE workflow system:
- VS Code extension for developers
- Hosted API + Postgres system of record
- Dashboard for PM setup and task operations

Compatibility note:
- Preferred repo config: `.relay/config.json`
- Legacy configs still supported: `.contexthud/config.json`, `.contexthud/users.json`

## 1) API Server Setup

Create `.env` from `.env.example`.

Required for API:
- `DATABASE_URL`
- `APP_BASE_URL`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET`
- `SLACK_SIGNING_SECRET`
- `SLACK_BOT_TOKEN`
- `ADMIN_API_KEY`

Optional:
- `ADMIN_GITHUB_LOGINS` (comma-separated GitHub logins with platform admin rights)

Run:

```bash
npm install
npm run db:migrate
npm run server:start
```

Health:

```bash
curl -i http://localhost:8787/health/live
curl -i http://localhost:8787/health
```

## 2) VS Code Extension Setup

Build and run:

```bash
npm run build
```

Press `F5` in VS Code to launch Extension Development Host.

Initialize repo config from command palette:
- `Relay: Initialize Project Config`

This creates:

```json
{
  "apiBaseUrl": "http://localhost:8787",
  "projectId": "<project-id>",
  "baseBranch": "main"
}
```

## 3) Dashboard Setup (Phase 4A)

Dashboard lives in `dashboard/` (Next.js App Router).

Install/run:

```bash
npm run dashboard:install
npm run dashboard:dev
```

By default dashboard runs at `http://localhost:3001`.

Dashboard env vars (see `dashboard/.env.example`):
- `RELAY_API_BASE_URL` (API root, e.g. `http://localhost:8787`)
- `NEXT_PUBLIC_API_BASE_URL` (same value; used in snippets/UI)
- `DASHBOARD_BASE_URL` (e.g. `http://localhost:3001`)
- `DASHBOARD_SESSION_SECRET` (required for httpOnly session cookies)
- `ADMIN_API_KEY` (optional fallback for admin-only project creation)

## 4) Slack Setup

### Event Subscriptions URL

Use:

- `POST /ingest/slack/:projectId`

Example:

- `https://<api-host>/ingest/slack/<projectId>`

### Slash Command URL

Use:

- `POST /slack/nudge?projectId=<projectId>`

### Required scopes/events

Scopes:
- `commands`
- `chat:write`
- `app_mentions:read`
- `channels:history`

Recommended events:
- `app_mention`
- `message.channels`

After scope/url changes, reinstall the Slack app in the workspace.

## 5) API Endpoints

### Auth
- `POST /auth/vscode/start`
- `GET /auth/github/login`
- `GET /auth/github/callback`
- `GET /auth/github/token?loginId=...`
- `GET /me`

### Admin key endpoints
- `POST /admin/projects`
- `POST /admin/projects/:projectId/members`
- `POST /admin/projects/:projectId/map/slack-user`
- `GET /admin/projects/:projectId/debug-assignment`

### Authenticated dashboard endpoints
- `GET /projects`
- `POST /projects` (platform admin required)
- `GET /projects/:projectId/members`
- `POST /projects/:projectId/members` (owner/admin)
- `GET /projects/:projectId/slack/status`
- `GET /projects/:projectId/slack/users`
- `POST /projects/:projectId/slack/map-user` (owner/admin)
- `GET /projects/:projectId/tasks?assigned=me|all&view=list|kanban`
- `POST /projects/:projectId/tasks`
- `GET /projects/:projectId/tasks/:taskId`
- `PATCH /projects/:projectId/tasks/:taskId`
- `POST /projects/:projectId/tasks/:taskId/commits`

### Slack ingest endpoints
- `POST /ingest/slack/:projectId`
- `POST /ingest/slack-nudge/:projectId`
- `POST /slack/nudge?projectId=<projectId>`

## 6) Dashboard Pages

- `/login`
  - GitHub sign-in start + completion
- `/projects`
  - List projects
  - Create project
  - Add members by GitHub login
  - Repo config snippet generator
- `/projects/[projectId]/integrations/slack`
  - Request URL display
  - Verification status + last event
  - Slack user mapping UI
- `/projects/[projectId]/tasks`
  - Task list (status + assignee)
  - Create task
  - Update status/assignee

## 7) Deployment Notes (Railway)

API service:
- Start command: `npm run railway:start`
- Set all required API env vars listed above

Dashboard service (separate Railway service recommended):
- Root directory: `dashboard`
- Build command: `npm run build`
- Start command: `npm run start`
- Set dashboard env vars from section 3

## 8) Manual Test Checklist

1. Start API + run migrations.
2. Sign into dashboard at `/login`.
3. Create project in `/projects`.
4. Add yourself as member/owner.
5. Configure Slack request URLs for that `projectId`.
6. Map Slack user to GitHub login in Slack integration page.
7. Create task from Slack; confirm it appears in dashboard tasks.
8. Create/update task from dashboard; confirm persisted state.
9. Open VS Code extension, point to same API/project, verify same tasks load.
