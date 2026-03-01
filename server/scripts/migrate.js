const { initSchema } = require('../lib/db');

try {
  initSchema();
  console.log('Migration applied: server/sql/init.sql');
} catch (error) {
  console.error('Migration failed:', error);
  process.exitCode = 1;
}
