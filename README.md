# Relay (Phase 0)

Local PM-to-developer workflow system with:

- Slack ingestion (`POST /ingest/slack`)
- SQLite as system of record
- VS Code sidebar list + task detail editor webview

## Run

```bash
cd /Users/mayankjain/Projects/extension_hub
npm run db:migrate
npm run server:start
npm run build
```

Then in VS Code run `Run Extension` (F5) and open ContextHUD.

## Backend API (v0)

- `POST /ingest/slack`
  - Ingests Slack task text (e.g. `@mayank [task] Fix login redirect #priority:high file:src/auth.ts`)
  - Creates task in SQLite
- `GET /tasks?assignee=me`
  - Uses `x-current-user` header for `me`
- `GET /tasks/:id`
  - Returns detailed task
- `PATCH /tasks/:id`
  - Updates status/title/description/linked files/branch
- `POST /tasks/:id/ai/summarize`
  - Stores AI-style structured fields (`ai_title`, `ai_summary`, `ai_acceptance_criteria`, `ai_open_questions`, `ai_tags`)

Compatibility:

- `POST /slack/nudge` still supported and routed to ingest behavior.

## Storage

SQLite file path:

- `server/data/contexthud.db`

Schema file:

- `server/sql/init.sql`

Tables:

- `tasks`
- `task_links`
- `task_comments`

## VS Code UX (v0)

- Sidebar: list only (title, status pill, timestamp/source)
- Click task: opens `Task Detail` editor-tab webview
- Task Detail actions:
  - Start Task
  - Mark status (Todo / In Progress / Blocked / Done)
  - Open Slack Thread
  - Ask AI (summarize)
  - Save patch (title/description/linked files/branch)

## Slack Text Conventions

Examples:

- `@mayank [task] Fix login redirect on mobile safari — callback state mismatch`
- `@mayank [task] Add retry logic #priority:high #due:2026-03-10 file:src/api/client.ts`

## Tests

```bash
npm run test:server
npm run build
```
