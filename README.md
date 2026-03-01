# Relay / ContextHUD

ContextHUD is a Slack-to-IDE workflow extension with a hosted backend.

This phase adds:

- Hosted backend with Postgres
- Multi-project scoping (`projectId`)
- GitHub OAuth token auth for VS Code
- Slack signature verification
- Admin endpoints for project setup and Slack user mapping
- Repo-local config via `.contexthud/config.json`

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

## Backend Run

```bash
npm install
npm run db:migrate
npm run server:start
```

## Extension Run

```bash
npm run build
```

In VS Code, press `F5` to open Extension Development Host.

## Project Config (per repo)

In the extension host, run command:

- `ContextHUD: Initialize Project Config`

It creates `.contexthud/config.json`:

```json
{
  "apiBaseUrl": "http://localhost:8787",
  "projectId": "<project-id>",
  "baseBranch": "main"
}
```

## Admin Setup (no dashboard)

All admin calls require `x-admin-api-key: <ADMIN_API_KEY>`.

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

## Slack Ingest

Project-scoped ingest endpoint:

- `POST /ingest/slack/:projectId`

Set this URL in Slack command/event config.

Slack signatures are required and verified using `SLACK_SIGNING_SECRET`.

## Auth Flow (VS Code)

1. In sidebar, click `Sign in with GitHub`.
2. Browser opens GitHub OAuth.
3. After callback page says signed in, extension polls `/auth/github/token` and stores token in VS Code secrets.
4. Extension calls project APIs with `Authorization: Bearer <token>`.

## API (project scoped)

Authenticated + project membership required:

- `GET /projects/:projectId/tasks?assigned=me|all`
- `GET /projects/:projectId/tasks/:taskId`
- `PATCH /projects/:projectId/tasks/:taskId`
- `POST /projects/:projectId/tasks/:taskId/commits`

## Health

- `GET /health` returns DB connectivity status.

## Troubleshooting

### Slack says: `no such table: main.tasks_old`

This error is from an old SQLite-era backend process/database. Current Phase 3.5 uses Postgres and should never reference `tasks_old`.

Recovery steps:

1. Stop all old backend processes on port `8787`.
2. Ensure you are in this repo: `/Users/mayankjain/Projects/extension_hub`.
3. Confirm `.env` has a valid `DATABASE_URL` for Postgres.
4. Run:

```bash
npm run db:migrate
npm run server:start
```

5. Update Slack request URL to your current hosted endpoint:
   - `/ingest/slack/:projectId`
6. Re-test with:

```bash
curl http://localhost:8787/health
```

If Slack still returns `tasks_old`, your Slack app is still pointed at a stale server URL/process.

## Diagnostics command

Run:

- `ContextHUD: Run Diagnostics`

It prints:

- loaded repo config
- signed-in user
- repo root + branch
- backend health + response
- last sync timestamp

## Manual Pilot Test Checklist

1. Start Postgres and backend (`db:migrate`, `server:start`).
2. Create project via admin endpoint.
3. Initialize `.contexthud/config.json` with that `projectId`.
4. Sign in from extension.
5. Add project member for your user.
6. Verify `My Tasks` only shows assigned tasks.
7. Configure Slack to call `/ingest/slack/:projectId`.
8. Create task in Slack for mapped user.
9. Verify task appears in extension.
10. Change task status in IDE and verify Slack thread update.
11. Verify non-member token gets `403` on project task endpoints.
