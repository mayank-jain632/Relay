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

Link workspace from command palette:
- `Relay: Link Workspace`

This uses a pair code from dashboard and writes `.relay/config.json` automatically.

Manual fallback still exists:
- `Relay: Initialize Project Config`

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
- `DASHBOARD_ADMIN_API_KEY` (recommended if project creation is admin-only on API)
- `RELAY_ADMIN_API_KEY` or `ADMIN_API_KEY` (legacy fallbacks)

## 4) PM Onboarding Flow (Frictionless)

Dashboard goal flow:
1. Create workspace
2. Connect Slack
3. Generate pair code for developer
4. Developer runs `Relay: Link Workspace` in VS Code
5. Share invite link with teammates

No manual JSON config copy required.

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
- `POST /ingest/slack` (global, preferred)
- `POST /ingest/slack/:projectId`
- `POST /ingest/slack-nudge/:projectId`
- `POST /slack/nudge?projectId=<projectId>`

#### /nudge input format
- Use explicit file prefix to avoid ambiguity: `%path/to/file.ts`
- If no prefixed file is provided, full text after assignee is treated as task description
- Examples:
  - `/nudge @mayank %src/extension.ts Fix refresh bug`
  - `/nudge @mayank Build xyz`

### Onboarding endpoints
- `POST /projects/:projectId/slack/connect`
- `POST /projects/:projectId/pair-codes`
- `POST /pair/verify`
- `POST /projects/:projectId/invites`
- `POST /invites/:token/accept`
- `GET /projects/:projectId/onboarding`

## 6) Dashboard Pages

- `/login`
  - GitHub sign-in start + completion
- `/projects`
  - List/create workspaces
  - Onboarding checklist
  - Connect Slack button
  - Pair code generation
  - Invite link generation
- `/projects/[projectId]/integrations/slack`
  - Connection status + last event
  - Auto-linking visibility for Slack users
- `/projects/[projectId]/tasks`
  - Task list (status + assignee)
  - Create task
  - Update status/assignee
- `/join/[token]`
  - Join-by-link workspace invite flow

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

## 9) Public Slack App Readiness

Before enabling Slack public distribution, ensure these repo and platform settings are in place.

### Repo hygiene
- Keep secrets only in env vars.
- Do not commit local runtime config files:
  - `.relay/config.json`
  - `.relay/users.json`
  - `.contexthud/config.json`
  - `.contexthud/users.json`
  - `.vscode/settings.json`
- Use templates instead:
  - `.relay/config.example.json`
  - `.contexthud/config.example.json`
  - `.contexthud/users.example.json`
  - `.vscode/settings.example.json`

### Slack app settings (single official Relay app)
- **OAuth Redirect URL**: `https://<API_DOMAIN>/auth/slack/callback`
- **Event Request URL**: `https://<API_DOMAIN>/ingest/slack`
- **Slash Command URL**: `https://<API_DOMAIN>/slack/nudge`
- Required bot scopes currently used by API:
  - `commands`
  - `chat:write`
  - `app_mentions:read`
  - `channels:history`
  - `users:read`
  - `im:write`

### GitHub OAuth settings
- In your GitHub OAuth app, set callback URL to:
  - `https://<API_DOMAIN>/auth/github/callback`

### Railway (API service) env vars
Set at minimum:
- `DATABASE_URL`
- `APP_BASE_URL`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET`
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_SIGNING_SECRET`
- `SLACK_BOT_TOKEN`
- `ADMIN_API_KEY`

Optional but recommended:
- `SLACK_REDIRECT_URI` = `https://<API_DOMAIN>/auth/slack/callback`
- `GITHUB_WEBHOOK_SECRET` (for PR-merge auto-close webhook)
- `ADMIN_GITHUB_LOGINS`

### Vercel (Dashboard) env vars
- `RELAY_API_BASE_URL` = `https://<API_DOMAIN>`
- `NEXT_PUBLIC_API_BASE_URL` = `https://<API_DOMAIN>`
- `DASHBOARD_BASE_URL` = `https://<DASHBOARD_DOMAIN>`
- `DASHBOARD_SESSION_SECRET`
- `DASHBOARD_ADMIN_API_KEY` (if project creation is admin-guarded)

After any env update, redeploy both services.

