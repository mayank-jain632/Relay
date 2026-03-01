const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(process.cwd(), 'server', 'data');
const dbPath = process.env.SQLITE_DB_PATH || path.join(dataDir, 'contexthud.db');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function safeAlter(sql) {
  try {
    db.exec(sql);
  } catch {
    // ignore: column may already exist
  }
}

function hasColumn(tableName, columnName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return rows.some((row) => row.name === columnName);
}

function getTableSql(tableName) {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName);
  return String(row?.sql || '');
}

function recreateTaskChildTables() {
  const hasTaskLinks = Boolean(getTableSql('task_links'));
  const hasTaskComments = Boolean(getTableSql('task_comments'));

  if (hasTaskLinks) {
    db.exec('ALTER TABLE task_links RENAME TO task_links_old;');
    db.exec(`
      CREATE TABLE task_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        link_type TEXT NOT NULL,
        url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id)
      );
    `);
    db.exec(`
      INSERT INTO task_links (id, task_id, link_type, url, created_at)
      SELECT id, task_id, link_type, url, created_at FROM task_links_old;
    `);
    db.exec('DROP TABLE task_links_old;');
  }

  if (hasTaskComments) {
    db.exec('ALTER TABLE task_comments RENAME TO task_comments_old;');
    db.exec(`
      CREATE TABLE task_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        author_id TEXT,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id)
      );
    `);
    db.exec(`
      INSERT INTO task_comments (id, task_id, author_id, body, created_at)
      SELECT id, task_id, author_id, body, created_at FROM task_comments_old;
    `);
    db.exec('DROP TABLE task_comments_old;');
  }
}

function repairChildTablesIfReferencingTasksOld() {
  const linksSql = getTableSql('task_links').toLowerCase();
  const commentsSql = getTableSql('task_comments').toLowerCase();
  const needsRepair = linksSql.includes('tasks_old') || commentsSql.includes('tasks_old');

  if (!needsRepair) {
    return;
  }

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN;');

  try {
    recreateTaskChildTables();
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function rebuildTasksTableIfNeeded() {
  const tableSql = getTableSql('tasks').toLowerCase();
  if (!tableSql) {
    return;
  }

  const requiredColumns = [
    'assigned_to_user_id',
    'pending_slack_assignee',
    'created_by_user_id',
    'updated_by_user_id',
    'pr_url',
    'auto_close_on_merge'
  ];

  const sourceCols = new Set(db.prepare('PRAGMA table_info(tasks)').all().map((row) => row.name));
  const missingColumn = requiredColumns.some((name) => !sourceCols.has(name));
  const needsReviewStatus = !tableSql.includes("'review'");

  if (!missingColumn && !needsReviewStatus) {
    return;
  }

  const selectOrDefault = (name, fallbackSql) => (sourceCols.has(name) ? name : `${fallbackSql} AS ${name}`);

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN;');

  try {
    db.exec('ALTER TABLE tasks RENAME TO tasks_old;');

    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        assignee_id TEXT,
        assigned_to_user_id TEXT,
        pending_slack_assignee TEXT,
        created_by_user_id TEXT,
        updated_by_user_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'blocked', 'review', 'done')),
        priority TEXT,
        due_date TEXT,
        order_index INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'slack',
        source_url TEXT,
        slack_user_id TEXT,
        slack_channel_id TEXT,
        slack_thread_ts TEXT,
        linked_files TEXT NOT NULL DEFAULT '[]',
        branch_name TEXT,
        pr_url TEXT,
        auto_close_on_merge INTEGER NOT NULL DEFAULT 0,
        commits TEXT NOT NULL DEFAULT '[]',
        ai_title TEXT,
        ai_summary TEXT,
        ai_acceptance_criteria TEXT NOT NULL DEFAULT '[]',
        ai_open_questions TEXT NOT NULL DEFAULT '[]',
        ai_tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(assigned_to_user_id) REFERENCES users(id),
        FOREIGN KEY(created_by_user_id) REFERENCES users(id),
        FOREIGN KEY(updated_by_user_id) REFERENCES users(id)
      );
    `);

    const insertSql = `
      INSERT INTO tasks (
        id, assignee_id, assigned_to_user_id, pending_slack_assignee, created_by_user_id, updated_by_user_id,
        title, description, status, priority, due_date, order_index, source, source_url,
        slack_user_id, slack_channel_id, slack_thread_ts, linked_files, branch_name, pr_url, auto_close_on_merge,
        commits, ai_title, ai_summary, ai_acceptance_criteria, ai_open_questions, ai_tags,
        created_at, updated_at
      )
      SELECT
        ${selectOrDefault('id', 'NULL')},
        ${selectOrDefault('assignee_id', 'NULL')},
        ${selectOrDefault('assigned_to_user_id', 'NULL')},
        ${selectOrDefault('pending_slack_assignee', 'NULL')},
        ${selectOrDefault('created_by_user_id', 'NULL')},
        ${selectOrDefault('updated_by_user_id', 'NULL')},
        ${selectOrDefault('title', "''")},
        ${selectOrDefault('description', "''")},
        CASE
          WHEN ${sourceCols.has('status') ? 'status' : "'todo'"} IN ('todo','in_progress','blocked','review','done')
          THEN ${sourceCols.has('status') ? 'status' : "'todo'"}
          ELSE 'todo'
        END,
        ${selectOrDefault('priority', 'NULL')},
        ${selectOrDefault('due_date', 'NULL')},
        ${selectOrDefault('order_index', '0')},
        ${selectOrDefault('source', "'slack'")},
        ${selectOrDefault('source_url', 'NULL')},
        ${selectOrDefault('slack_user_id', 'NULL')},
        ${selectOrDefault('slack_channel_id', 'NULL')},
        ${selectOrDefault('slack_thread_ts', 'NULL')},
        ${selectOrDefault('linked_files', "'[]'")},
        ${selectOrDefault('branch_name', 'NULL')},
        ${selectOrDefault('pr_url', 'NULL')},
        ${selectOrDefault('auto_close_on_merge', '0')},
        ${selectOrDefault('commits', "'[]'")},
        ${selectOrDefault('ai_title', 'NULL')},
        ${selectOrDefault('ai_summary', 'NULL')},
        ${selectOrDefault('ai_acceptance_criteria', "'[]'")},
        ${selectOrDefault('ai_open_questions', "'[]'")},
        ${selectOrDefault('ai_tags', "'[]'")},
        ${selectOrDefault('created_at', "datetime('now')")},
        ${selectOrDefault('updated_at', "datetime('now')")}
      FROM tasks_old;
    `;

    db.exec(insertSql);
    recreateTaskChildTables();
    db.exec('DROP TABLE tasks_old;');
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function initSchema() {
  const schemaPath = path.join(process.cwd(), 'server', 'sql', 'init.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  try {
    db.exec(sql);
  } catch {
    // Existing DBs can fail during bootstrap before column backfills; continue with safe alters.
  }

  safeAlter(`ALTER TABLE tasks ADD COLUMN assigned_to_user_id TEXT`);
  safeAlter(`ALTER TABLE tasks ADD COLUMN pending_slack_assignee TEXT`);
  safeAlter(`ALTER TABLE tasks ADD COLUMN created_by_user_id TEXT`);
  safeAlter(`ALTER TABLE tasks ADD COLUMN updated_by_user_id TEXT`);
  safeAlter(`ALTER TABLE tasks ADD COLUMN commits TEXT NOT NULL DEFAULT '[]'`);
  safeAlter(`ALTER TABLE tasks ADD COLUMN pr_url TEXT`);
  safeAlter(`ALTER TABLE tasks ADD COLUMN auto_close_on_merge INTEGER NOT NULL DEFAULT 0`);

  rebuildTasksTableIfNeeded();
  repairChildTablesIfReferencingTasksOld();
  db.exec(sql);
}

function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}

function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

module.exports = {
  all,
  db,
  get,
  initSchema,
  run
};
