const test = require('node:test');
const assert = require('node:assert/strict');

const { extractSlackUserId, parseNudgeInput } = require('../lib/slack-parser');

test('extractSlackUserId handles formatted mention token', () => {
  assert.equal(extractSlackUserId('<@U123ABC|mayank>'), 'U123ABC');
});

test('extractSlackUserId handles @username fallback', () => {
  assert.equal(extractSlackUserId('@mayank'), 'mayank');
});

test('parseNudgeInput parses user, filePath, and description', () => {
  const parsed = parseNudgeInput('<@U999> src/extension.ts implement private filter');

  assert.deepEqual(parsed, {
    slackUserId: 'U999',
    filePath: 'src/extension.ts',
    description: 'implement private filter'
  });
});

test('parseNudgeInput throws on invalid format', () => {
  assert.throws(
    () => parseNudgeInput('<@U999> onlyfilepath'),
    /Invalid nudge format/
  );
});
