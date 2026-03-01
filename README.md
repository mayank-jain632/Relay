# Relay (ContextHUD)

Local PM-to-developer workflow system with:

- Slack ingestion (`POST /ingest/slack`, `POST /slack/nudge`)
- SQLite system of record
- VS Code sidebar + task detail panel
- Git execution flow (`Start Task` -> branch, `Open PR` -> review)
- Slack thread status reporting on status changes
- GitHub OAuth sign-in for multi-user attribution + `My Tasks`

## 1) Prerequisites

- Node.js 20+ (you are on Node 25)
- VS Code
- A GitHub OAuth App
- Optional: Slack app + slash command

## 2) GitHub OAuth App Setup

In GitHub -> `Settings` -> `Developer settings` -> `OAuth Apps` -> `New OAuth App`:

- `Application name`: `Relay Local`
- `Homepage URL`: `http://localhost:8787`
- `Authorization callback URL`: `http://localhost:8787/auth/github/callback`

Copy:

- Client ID
- Client Secret

## 3) Environment Setup

`.env` is required. This repo already includes one; set values:

```bash
PORT=8787
APP_BASE_URL=http://localhost:8787
SESSION_SECRET=use-a-long-random-string
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
SLACK_BOT_TOKEN=xoxb-...   # optional for Slack thread updates
CONTEXTHUD_USER_HANDLE=     # optional legacy fallback filter
```

Notes:

- `SESSION_SECRET` is required for auth endpoints.
- Keep `APP_BASE_URL` exactly aligned with OAuth callback host/port.

## 4) Run Locally

```bash
cd /Users/mayankjain/Projects/extension_hub
npm run db:migrate
npm run server:start
npm run build
```

Then in VS Code:

- Press `F5` (Run Extension)
- In Extension Development Host, open ContextHUD view

## 5) VS Code Settings

Workspace `.vscode/settings.json`:

```json
{
  "contexthud.apiBaseUrl": "http://localhost:8787",
  "contexthud.git.branchPrefix": "ch",
  "contexthud.git.baseBranch": "main",
  "contexthud.git.commitPollIntervalSec": 15,
  "contexthud.user.handle": ""
}
```

Notes:

- With OAuth sign-in, filtering uses authenticated user + `assigned=me`.
- `contexthud.user.handle` is only a non-auth fallback.

## 6) Backend API (Phase 3)

### Auth

- `POST /auth/vscode/start`
  - Starts VS Code login attempt
  - Returns `{ loginId, loginUrl }`
- `GET /auth/github/login`
- `GET /auth/github/callback`
- `GET /me`
  - With `Authorization: Bearer <token>` -> returns user
  - During VS Code polling, extension sends `X-Vscode-Login-Id`
- `POST /auth/logout`

### Task + Mapping

- `POST /ingest/slack`
- `POST /slack/nudge`
- `POST /admin/map/slack-user`
  - body: `{ "slackUserId": "U...", "githubLogin": "mayank" }`
- `GET /tasks?assigned=me|all`
- `GET /tasks?assignee=<legacy_handle>`
- `GET /tasks/:id`
- `PATCH /tasks/:id`
- `POST /tasks/:id/commits`

## 7) Slack Assignment Mapping (Team Pilot)

Slack mention ingestion stores Slack assignee identity. To bind Slack assignees to GitHub users:

1. Sign in once from VS Code as each dev (creates `users` row).
2. Map Slack user to GitHub user:

```bash
curl -X POST http://localhost:8787/admin/map/slack-user \
  -H 'Content-Type: application/json' \
  -d '{"slackUserId":"U0AHSSHHURG","githubLogin":"mayankjain"}'
```

3. New Slack-created tasks for that Slack user auto-assign to that GitHub user.
4. Existing pending tasks for that Slack user are backfilled.

## 8) Manual Test Checklist

### A) OAuth + /me

1. Start server (`npm run server:start`).
2. In extension host, open ContextHUD.
3. Click `Sign in with GitHub`.
4. Browser opens GitHub consent page; complete login.
5. Browser shows: `✅ Signed in to Relay`.
6. Extension sidebar shows avatar/login and defaults to `My Tasks`.

### B) Task filtering

1. In sidebar, switch between `My Tasks` and `All Tasks`.
2. Verify `My Tasks` only shows tasks assigned to your authenticated user.

### C) Slack ingestion + mapping

1. Ensure Slack slash command points to your backend/ngrok route.
2. Create task mentioning mapped Slack user.
3. Verify task appears under that user’s `My Tasks`.

### D) Attribution + lifecycle

1. Open task detail.
2. Click `Start Task` -> status `In Progress`.
3. Click `Open PR` -> status `Review` + PR URL saved.
4. Click `Done` -> status `Done`.
5. Verify detail shows `Updated by <login> at <time>`.

### E) Slack reporting

1. Confirm task has Slack metadata (`slackChannelId` and optionally `slackThreadTs`).
2. Change status in IDE.
3. Verify backend posts update to Slack thread (if `SLACK_BOT_TOKEN` is set).

## 9) Test Commands

```bash
npm run db:migrate
npm test
npm run build
```
