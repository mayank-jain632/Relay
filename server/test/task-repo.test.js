const test = require('node:test');
const assert = require('node:assert/strict');

const { localAiSummarize } = require('../lib/task-repo');

test('localAiSummarize builds structured fields', () => {
  const task = {
    title: 'Fix login redirect',
    description: 'Mobile Safari callback breaks after OAuth. Investigate auth flow and patch redirect handling.',
    status: 'todo',
    priority: 'high',
    linkedFiles: ['src/auth.ts']
  };

  const ai = localAiSummarize(task);

  assert.equal(ai.ai_title, 'Fix login redirect');
  assert.ok(ai.ai_summary.includes('Mobile Safari'));
  assert.ok(Array.isArray(ai.ai_acceptance_criteria));
  assert.ok(Array.isArray(ai.ai_open_questions));
  assert.ok(Array.isArray(ai.ai_tags));
});
