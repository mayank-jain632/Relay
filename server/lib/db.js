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

function initSchema() {
  const schemaPath = path.join(process.cwd(), 'server', 'sql', 'init.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(sql);

  // Backward-compatible migrations for existing local DBs.
  safeAlter(`ALTER TABLE tasks ADD COLUMN commits TEXT NOT NULL DEFAULT '[]'`);
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
