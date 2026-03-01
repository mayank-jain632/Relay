# Relay

Local PM-to-developer workflow system with:

- Slack ingestion (`POST /ingest/slack`)
- SQLite as system of record
- VS Code sidebar + task detail panel
- Git execution flow (`Start Task` -> branch, `Open PR` -> review)
- Slack thread status reporting on status changes

## Run

```bash
cd /Users/mayankjain/Projects/extension_hub
npm run db:migrate
npm run server:start
npm run build
```

Then in VS Code run `Run Extension` (F5) and open ContextHUD.

## Required Env

Copy `.env.example` to `.env` and set:

- `SLACK_BOT_TOKEN`: bot token used for thread status updates (`chat.postMessage`)
- `CONTEXTHUD_USER_HANDLE` (optional): local handle fallback for ingestion mapping

## VS Code Settings

In workspace `.vscode/settings.json`:

```json
{
  "contexthud.apiBaseUrl": "http://localhost:8787",
  "contexthud.git.branchPrefix": "ch",
  "contexthud.git.baseBranch": "main",
  "contexthud.git.commitPollIntervalSec": 15,
  "contexthud.user.handle": "mayank"
}
```

Notes:

- `contexthud.user.handle` is optional.
- If set, extension fetches `GET /tasks?assignee=<handle>`.
- If unset, extension shows all tasks.

## Backend API (P1.2)

- `POST /ingest/slack`
  - Ingests Slack text (e.g. `@mayank [task] Fix login redirect #priority:high file:src/auth.ts`)
- `GET /tasks?assignee=<handle>`
  - Optional assignee filtering
- `GET /tasks/:id`
- `PATCH /tasks/:id`
  - Updates status/title/description/linked files/branch/prUrl/autoCloseOnMerge
  - On status change, posts update to Slack thread when `slackChannelId` + `slackThreadTs` exist
- `POST /tasks/:id/commits`
  - Links commit to task

Compatibility:

- `POST /slack/nudge` remains supported.

## Status Lifecycle

Allowed statuses:

- `todo`
- `in_progress`
- `blocked`
- `review`
- `done`

Transitions:

- `Start Task` -> sets `in_progress`
- `Open PR` -> opens compare URL, saves `prUrl`, sets `review`
- `Done` button -> sets `done`

Status changes are reported to Slack thread when metadata exists on task.

## Task Detail UI

- Status action buttons: Todo / In Progress / Blocked / Review / Done
- Prominent current status badge
- `Start Task`
- `Open PR`
- `Auto-close when PR merges` checkbox (stored only)
- Commit list

## Slack Text Conventions

Examples:

- `@mayank [task] Fix login redirect on mobile safari — callback state mismatch`
- `@mayank [task] Add retry logic #priority:high #due:2026-03-10 file:src/api/client.ts`

## Tests

```bash
npm run test
```
