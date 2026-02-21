function runQuery(text, params = []) {
  const { query } = require('./db');
  return query(text, params);
}

function mapRowToTask(row) {
  return {
    id: row.id,
    assignee_id: row.assignee_id,
    filePath: row.file_path,
    description: row.description,
    orderIndex: row.order_index,
    status: row.status,
    timestamp: row.created_at,
    pmSlackId: row.pm_slack_id || '',
    completedAt: row.completed_at || null
  };
}

function computeNextOrderIndexFromRows(rows) {
  const maxIndex = rows.reduce((max, row) => Math.max(max, Number(row.order_index || 0)), 0);
  return maxIndex + 1;
}

async function listTasks() {
  const result = await runQuery(
    `SELECT id, assignee_id, file_path, description, order_index, status, created_at, pm_slack_id, completed_at
     FROM tasks
     ORDER BY assignee_id ASC, order_index ASC, created_at ASC`
  );

  return result.rows.map(mapRowToTask);
}

async function nextOrderIndex(assigneeId) {
  const result = await runQuery(
    `SELECT order_index
     FROM tasks
     WHERE assignee_id = $1 AND status = 'pending'`,
    [assigneeId]
  );

  return computeNextOrderIndexFromRows(result.rows);
}

async function insertTask(task) {
  const result = await runQuery(
    `INSERT INTO tasks (
      id, assignee_id, file_path, description, order_index, status, created_at, pm_slack_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, assignee_id, file_path, description, order_index, status, created_at, pm_slack_id, completed_at`,
    [
      task.id,
      task.assignee_id,
      task.filePath,
      task.description,
      task.orderIndex,
      task.status,
      task.timestamp,
      task.pmSlackId || null
    ]
  );

  return mapRowToTask(result.rows[0]);
}

async function completeTask(taskId) {
  const result = await runQuery(
    `UPDATE tasks
     SET status = 'completed', completed_at = NOW()
     WHERE id = $1 AND status <> 'completed'
     RETURNING id, assignee_id, file_path, description, order_index, status, created_at, pm_slack_id, completed_at`,
    [taskId]
  );

  if (!result.rows.length) {
    return null;
  }

  return mapRowToTask(result.rows[0]);
}

module.exports = {
  completeTask,
  computeNextOrderIndexFromRows,
  insertTask,
  listTasks,
  mapRowToTask,
  nextOrderIndex
};
