const { loadEnv } = require('../lib/env');
const { closePool, query } = require('../lib/db');
const { upsertSlackLink, upsertGithubLink, insertTaskEvent } = require('../lib/task-repo-v2');

function inferRepoFromPrUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/github\.com\/([^\/]+)\/([^\/?#]+)/i);
  if (!match) {
    return null;
  }

  return (match[1] + '/' + match[2]).toLowerCase();
}

function parseArgs(argv) {
  const flags = {
    dryRun: false,
    limit: null,
    workspace: null
  };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      flags.limit = Number(arg.slice('--limit='.length)) || null;
      continue;
    }
    if (arg.startsWith('--workspace=')) {
      flags.workspace = String(arg.slice('--workspace='.length)).trim() || null;
    }
  }

  return flags;
}

async function run() {
  loadEnv();
  const flags = parseArgs(process.argv.slice(2));

  const where = [];
  const params = [];
  if (flags.workspace) {
    params.push(flags.workspace);
    where.push(`t.project_id = $${params.length}`);
  }

  let sql = `
    SELECT t.id,
           t.project_id,
           t.slack_workspace_id,
           t.slack_channel_id,
           t.slack_thread_ts,
           t.branch_name,
           t.pr_url,
           t.created_at,
           t.updated_at
      FROM tasks t
  `;

  if (where.length > 0) {
    sql += ` WHERE ${where.join(' AND ')}`;
  }

  sql += ' ORDER BY t.created_at ASC';
  if (flags.limit) {
    params.push(flags.limit);
    sql += ` LIMIT $${params.length}`;
  }

  const rows = (await query(sql, params)).rows;

  const stats = {
    scanned: rows.length,
    slackLinked: 0,
    githubLinked: 0,
    eventsWritten: 0,
    skipped: 0,
    errors: 0
  };

  for (const row of rows) {
    try {
      let wrote = false;

      if (row.slack_workspace_id && row.slack_channel_id && row.slack_thread_ts) {
        if (!flags.dryRun) {
          await upsertSlackLink({
            taskId: row.id,
            slackTeamId: row.slack_workspace_id,
            slackChannelId: row.slack_channel_id,
            slackThreadTs: row.slack_thread_ts,
            slackMessageTs: null
          });
        }
        stats.slackLinked += 1;
        wrote = true;
      }

      if (row.branch_name || row.pr_url) {
        if (!flags.dryRun) {
          await upsertGithubLink({
            taskId: row.id,
            repoFullName: inferRepoFromPrUrl(row.pr_url) || 'unknown/unknown',
            branchName: row.branch_name || null,
            prUrl: row.pr_url || null,
            prState: null
          });
        }
        stats.githubLinked += 1;
        wrote = true;
      }

      if (wrote) {
        if (!flags.dryRun) {
          await insertTaskEvent({
            taskId: row.id,
            type: 'imported',
            payload: {
              from: 'legacy_tasks',
              projectId: row.project_id
            }
          });
        }
        stats.eventsWritten += 1;
      } else {
        stats.skipped += 1;
      }
    } catch (error) {
      stats.errors += 1;
      console.error('Backfill item failed', {
        taskId: row.id,
        error: String(error?.message || error)
      });
    }
  }

  console.log(JSON.stringify({ ok: true, dryRun: flags.dryRun, ...stats }, null, 2));
}

void run()
  .catch((error) => {
    console.error('Backfill failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
