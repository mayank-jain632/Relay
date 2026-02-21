# ContextHUD

ContextHUD is a PM-to-Developer workflow tool that syncs a prioritized Slack task queue into a VS Code sidebar.

## Backend (Local PostgreSQL)

This repo now uses PostgreSQL (not JSON files) for task persistence.

### Database schema

Defined in `server/sql/init.sql`:

- `id UUID PRIMARY KEY`
- `assignee_id TEXT`
- `file_path TEXT`
- `description TEXT`
- `order_index INTEGER`
- `status ENUM-like check ('pending' | 'completed')`
- `created_at TIMESTAMPTZ`
- `pm_slack_id TEXT`
- `completed_at TIMESTAMPTZ`

## Key Files

- `server/server.js`: Express + Slack + Socket.io API
- `server/lib/db.js`: PostgreSQL pool/connection
- `server/lib/task-repo.js`: SQL repository methods
- `server/sql/init.sql`: migration SQL
- `server/scripts/migrate.js`: migration runner
- `src/extension.ts`: VS Code lifecycle + file trigger + done callback
- `src/SidebarProvider.ts`: sidebar HUD UI

## Local Setup (Demo)

1. Install dependencies:

```bash
npm install
```

2. Start PostgreSQL locally with Docker:

```bash
npm run db:up
```

3. Create your env file:

```bash
cp .env.example .env
```

4. Load env vars in your shell:

```bash
export $(cat .env | xargs)
```

5. Run DB migration:

```bash
npm run db:migrate
```

6. Start backend:

```bash
npm run server:start
```

7. Build extension:

```bash
npm run build
```

8. Start extension host in VS Code:
- Press `F5`

## User Mapping

Create `.contexthud/users.json`:

```json
{
  "U0123ABCDEF": "mayankjain"
}
```

- Key: Slack user ID (`U...`)
- Value: local/GitHub username (must match `contexthud.currentUser`)

## VS Code Settings

Put in `.vscode/settings.json`:

```json
{
  "contexthud.currentUser": "mayankjain",
  "contexthud.userMappingPath": ".contexthud/users.json",
  "contexthud.apiBaseUrl": "http://localhost:8787",
  "contexthud.socketUrl": "http://localhost:8787"
}
```

## Slack Command Contract

- Route: `POST /slack/nudge`
- Text format: `@user [file_path] [requirement]`
- Example: `/nudge @mayank src/extension.ts implement private filter`

Server flow:
1. Parse Slack command text.
2. Resolve Slack ID to local assignee via `.contexthud/users.json`.
3. Compute next `order_index` for that assignee.
4. Insert task in Postgres.
5. Emit `tasksUpdated` websocket event.

## Completion Flow

When user clicks `Done` in sidebar:
1. Webview posts message to extension.
2. Extension calls `POST /tasks/complete`.
3. Backend updates task row to `completed`.
4. Backend emits `tasksUpdated` for real-time refresh.
5. Backend DMs PM via Slack bot if `SLACK_BOT_TOKEN` is set.

## Scripts

- `npm run test:server`: server unit tests
- `npm run db:up`: start local Postgres
- `npm run db:down`: stop local Postgres
- `npm run db:migrate`: apply schema
- `npm run server:start`: run backend
- `npm run build`: compile extension
- `npm test`: server tests + extension build

## Notes

- Slack slash commands require a public HTTPS URL, not localhost directly.
- For local demo, use a tunnel (ngrok/cloudflared) to expose `http://localhost:8787`.
- Add Slack signature verification before production.
