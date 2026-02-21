const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSlackLookupKey, resolveAssigneeFromMap } = require('../lib/user-map');

test('normalizeSlackLookupKey strips @ and lowercases', () => {
  assert.equal(normalizeSlackLookupKey('@Mayank'), 'mayank');
});

test('resolveAssigneeFromMap resolves direct Slack ID key', () => {
  const mapping = { U0AG6APJ83X: 'mayankjain' };
  assert.equal(resolveAssigneeFromMap(mapping, 'U0AG6APJ83X'), 'mayankjain');
});

test('resolveAssigneeFromMap resolves username alias case-insensitively', () => {
  const mapping = { '@Mayank': 'mayankjain' };
  assert.equal(resolveAssigneeFromMap(mapping, 'mayank'), 'mayankjain');
});
