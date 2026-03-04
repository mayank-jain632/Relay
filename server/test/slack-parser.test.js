const test = require('node:test');
const assert = require('node:assert/strict');

const { extractSlackUserId, parseNudgeInput, parseSlackTaskText } = require('../lib/slack-parser');

test('extractSlackUserId handles formatted mention token', () => {
  assert.equal(extractSlackUserId('<@U123ABC|mayank>'), 'U123ABC');
});

test('extractSlackUserId handles @username fallback', () => {
  assert.equal(extractSlackUserId('@mayank'), 'mayank');
});

test('parseSlackTaskText parses tags and file hints', () => {
  const parsed = parseSlackTaskText('@mayank [task] Fix login redirect on Safari — callback breaks #priority:high #due:2026-03-10 file:src/auth.ts');

  assert.equal(parsed.assigneeRef, 'mayank');
  assert.equal(parsed.priority, 'high');
  assert.equal(parsed.dueDate, '2026-03-10');
  assert.deepEqual(parsed.linkedFiles, ['src/auth.ts']);
  assert.equal(parsed.title, 'Fix login redirect on Safari');
});

test('parseNudgeInput parses user, explicit %filePath, and description', () => {
  const parsed = parseNudgeInput('<@U999> %src/extension.ts implement private filter');

  assert.deepEqual(parsed, {
    slackUserId: 'U999',
    filePath: 'src/extension.ts',
    description: 'implement private filter'
  });
});

test('parseNudgeInput keeps first word in description when no explicit file path prefix exists', () => {
  const parsed = parseNudgeInput('@mayank Build xyz');

  assert.deepEqual(parsed, {
    slackUserId: 'mayank',
    filePath: undefined,
    description: 'Build xyz'
  });
});
