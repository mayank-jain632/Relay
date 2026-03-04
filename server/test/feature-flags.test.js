const test = require('node:test');
const assert = require('node:assert/strict');

const { asBoolean } = require('../lib/feature-flags');

test('asBoolean parses common truthy/falsey values', () => {
  assert.equal(asBoolean('true', false), true);
  assert.equal(asBoolean('1', false), true);
  assert.equal(asBoolean('yes', false), true);

  assert.equal(asBoolean('false', true), false);
  assert.equal(asBoolean('0', true), false);
  assert.equal(asBoolean('no', true), false);
});

test('asBoolean falls back to default on empty/unknown values', () => {
  assert.equal(asBoolean('', true), true);
  assert.equal(asBoolean(undefined, false), false);
  assert.equal(asBoolean('unexpected', true), true);
  assert.equal(asBoolean('unexpected', false), false);
});
