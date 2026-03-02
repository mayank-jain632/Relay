# Relay

Relay is a Slack-to-IDE workflow extension with a hosted backend.

This repo currently supports:

- Hosted backend with Postgres
- Multi-project scoping (`projectId`)
- GitHub OAuth (VS Code token flow)
- Slack signature verification
- Project admin endpoints (members + Slack mapping)
- Git workflow actions in the IDE (Start Task, Open PR, commit linking, diff views)

Compatibility note:
- Relay prefers `.relay/config.json` and `.relay/users.json`.
- Legacy `.contexthud/config.json` and `.contexthud/users.json` are still supported to avoid breakage.

## Environment

Create `.env`:

```env
PORT=8787
DATABASE_URL=postgres://postgres:postgres@localhost:5432/contexthud
APP_BASE_URL=http://localhost:8787
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
SESSION_SECRET=
SLACK_SIGNING_SECRET=
SLACK_BOT_TOKEN=
ADMIN_API_KEY=
```

## Run

```bash
npm install
npm run db:migrate
npm run server:start
npm run build
```

In VS Code, press `F5` to open Extension Development Host.

## Per-Repo Relay Config

In Extension Host command palette run:

- `Relay: Initialize Project Config`

It creates `.relay/config.json`:

```json
{
  "apiBaseUrl": "http://localhost:8787",
  "projectId": "<project-id>",
  "baseBranch": "main"
}
```

## Admin Setup (No Dashboard)

All admin calls require:

- Header `x-admin-api-key: <ADMIN_API_KEY>`

### 1) Create project

```bash
curl -X POST http://localhost:8787/admin/projects \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Relay Pilot"}'
```

### 2) Add member

```bash
curl -X POST http://localhost:8787/admin/projects/<projectId>/members \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"githubLogin":"your_github_login","role":"owner"}'
```

### 3) Map Slack user to GitHub user

```bash
curl -X POST http://localhost:8787/admin/projects/<projectId>/map/slack-user \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slackUserId":"U123ABC","githubLogin":"your_github_login"}'
```

### 4) Debug assignment state

```bash
curl -X GET http://localhost:8787/admin/projects/<projectId>/debug-assignment \
  -H "x-admin-api-key: $ADMIN_API_KEY"
```

## Slack Endpoints

Project-scoped ingest endpoints:

- `POST /ingest/slack/:projectId` (events + generic ingest)
- `POST /ingest/slack-nudge/:projectId` (slash-command style ingest)
- `POST /slack/nudge?projectId=<projectId>` (backward-compatible slash command route)

Slack signatures are verified with `SLACK_SIGNING_SECRET`.

## Auth Flow (VS Code)

1. Click `Sign in with GitHub` in Relay sidebar.
2. Complete browser OAuth.
3. Extension polls `/auth/github/token` and stores bearer token in VS Code secrets.
4. Relay calls project APIs with `Authorization: Bearer <token>`.

## Project API

Authenticated + project membership required:

- `GET /projects/:projectId/tasks?assigned=me|all`
- `GET /projects/:projectId/tasks/:taskId`
- `PATCH /projects/:projectId/tasks/:taskId`
- `POST /projects/:projectId/tasks/:taskId/commits`

## Health

- `GET /health/live`
- `GET /health`

## Diagnostics

Run command:

- `Relay: Run Diagnostics`

It reports:

- repo config
- signed-in user
- backend reachability
- repo root + branch
- last sync timestamp

## Relay Rename Checklist (Slack / GitHub / Railway)

Use this when moving from ContextHUD naming to Relay naming.

### Slack

1. In Slack app, set slash command Request URL to:
   - `https://<your-host>/slack/nudge?projectId=<projectId>`
2. In Event Subscriptions, set Request URL to:
   - `https://<your-host>/ingest/slack/<projectId>`
3. Ensure bot scopes include at least:
   - `commands`
   - `chat:write`
   - `app_mentions:read` (if using mention events)
   - `channels:history` (if reading channel messages/events)
4. Reinstall app to workspace after scope or endpoint changes.

### GitHub OAuth App

1. Set Authorization callback URL to:
   - `https://<your-host>/auth/github/callback`
2. Update backend env vars:
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `APP_BASE_URL=https://<your-host>`
3. Keep `SESSION_SECRET` set (required for signed login state/session artifacts).

### Railway

1. Confirm service start command:
   - `npm run railway:start`
2. Confirm required variables exist in Railway service:
   - `DATABASE_URL`
   - `APP_BASE_URL`
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `SESSION_SECRET`
   - `SLACK_SIGNING_SECRET`
   - `SLACK_BOT_TOKEN`
   - `ADMIN_API_KEY`
3. Redeploy after variable changes.
4. Verify:

```bash
curl -i https://<your-host>/health/live
curl -i https://<your-host>/health
```

## Manual Pilot Smoke Test

1. Run migrations and backend.
2. Create project via admin endpoint.
3. Initialize repo config (`Relay: Initialize Project Config`).
4. Sign in with GitHub.
5. Add yourself as project member.
6. Map your Slack user ID to your GitHub user.
7. Create Slack task for yourself.
8. Verify it appears in `My Tasks`.
9. Start task, open PR, change status, and verify Slack thread updates.
