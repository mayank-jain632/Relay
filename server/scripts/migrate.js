const fs = require('fs');
const path = require('path');
const { query, closePool } = require('../lib/db');

async function run() {
  const sqlPath = path.join(__dirname, '..', 'sql', 'init.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  await query(sql);
  console.log('Migration applied: server/sql/init.sql');
}

run()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
  });
