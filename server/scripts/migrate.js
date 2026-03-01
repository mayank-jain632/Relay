const { loadEnv } = require('../lib/env');
const { closePool, initSchema } = require('../lib/db');

async function run() {
  loadEnv();

  try {
    await initSchema();
    console.log('Migration applied: server/sql/init.sql');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

void run();
