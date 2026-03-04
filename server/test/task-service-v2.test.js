const test = require('node:test');
const assert = require('node:assert/strict');

const { mapGitHubPrStateToTaskStatus, pickStatusFromGithubLinks } = require('../lib/task-service-v2');

test('mapGitHubPrStateToTaskStatus maps merged/open/closed deterministically', () => {
  assert.equal(mapGitHubPrStateToTaskStatus('merged'), 'done');
  assert.equal(mapGitHubPrStateToTaskStatus('open'), 'review');
  assert.equal(mapGitHubPrStateToTaskStatus('closed'), 'todo');
  assert.equal(mapGitHubPrStateToTaskStatus('unknown'), null);
});

test('pickStatusFromGithubLinks returns done if any linked PR is merged', () => {
  const status = pickStatusFromGithubLinks([
    { pr_state: 'open', last_synced_at: '2026-03-01T00:00:00.000Z' },
    { pr_state: 'merged', last_synced_at: '2026-03-02T00:00:00.000Z' }
  ]);

  assert.equal(status, 'done');
});

test('pickStatusFromGithubLinks falls back to latest PR state when none merged', () => {
  const status = pickStatusFromGithubLinks([
    { pr_state: 'open', last_synced_at: '2026-03-02T00:00:00.000Z' },
    { pr_state: 'closed', last_synced_at: '2026-03-03T00:00:00.000Z' }
  ]);

  assert.equal(status, 'todo');
});
