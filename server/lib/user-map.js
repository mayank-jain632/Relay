const fs = require('fs');
const path = require('path');

const USER_MAP_PATH = path.join(process.cwd(), '.relay', 'users.json');
const LEGACY_USER_MAP_PATH = path.join(process.cwd(), '.contexthud', 'users.json');

function readUserMap() {
  for (const candidate of [USER_MAP_PATH, LEGACY_USER_MAP_PATH]) {
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      return JSON.parse(raw);
    } catch {
      // try next
    }
  }

  return {};
}

function normalizeSlackLookupKey(value) {
  return String(value || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

function resolveAssigneeFromMap(mapping, slackUserId) {
  if (!slackUserId) {
    return undefined;
  }

  const direct = mapping[slackUserId];
  if (direct) {
    return direct;
  }

  const normalizedTarget = normalizeSlackLookupKey(slackUserId);
  if (!normalizedTarget) {
    return undefined;
  }

  const matchKey = Object.keys(mapping).find(
    (candidate) => normalizeSlackLookupKey(candidate) === normalizedTarget
  );

  if (!matchKey) {
    return undefined;
  }

  return mapping[matchKey];
}

function resolveAssignee(slackUserId) {
  const mapping = readUserMap();
  return resolveAssigneeFromMap(mapping, slackUserId);
}

module.exports = {
  USER_MAP_PATH,
  LEGACY_USER_MAP_PATH,
  normalizeSlackLookupKey,
  readUserMap,
  resolveAssignee,
  resolveAssigneeFromMap
};
