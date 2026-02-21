const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeNextOrderIndexFromRows,
  mapRowToTask
} = require('../lib/task-repo');

test('computeNextOrderIndexFromRows increments max order_index', () => {
  const rows = [{ order_index: 1 }, { order_index: 4 }, { order_index: 2 }];
  assert.equal(computeNextOrderIndexFromRows(rows), 5);
});

test('computeNextOrderIndexFromRows starts at 1 for empty rows', () => {
  assert.equal(computeNextOrderIndexFromRows([]), 1);
});

test('mapRowToTask maps postgres column names to API model', () => {
  const task = mapRowToTask({
    id: 'abc',
    assignee_id: 'mayankjain',
    file_path: 'src/extension.ts',
    description: 'Implement filtering',
    order_index: 2,
    status: 'pending',
    created_at: '2026-02-20T20:00:00.000Z',
    pm_slack_id: 'U123',
    completed_at: null
  });

  assert.deepEqual(task, {
    id: 'abc',
    assignee_id: 'mayankjain',
    filePath: 'src/extension.ts',
    description: 'Implement filtering',
    orderIndex: 2,
    status: 'pending',
    timestamp: '2026-02-20T20:00:00.000Z',
    pmSlackId: 'U123',
    completedAt: null
  });
});
