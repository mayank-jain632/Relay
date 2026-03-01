function extractSlackUserId(token) {
  const normalized = String(token || '').trim();
  const mentionMatch = normalized.match(/^<@([A-Z0-9]+)(?:\|[^>]+)?>$/i);
  if (mentionMatch) {
    return mentionMatch[1];
  }

  if (normalized.startsWith('@')) {
    return normalized.slice(1);
  }

  return undefined;
}

function parseTaggedValue(text, tag) {
  const regex = new RegExp(`#${tag}:([^\\s]+)`, 'i');
  const match = text.match(regex);
  return match ? match[1] : undefined;
}

function parseFileHints(text) {
  const hints = [];
  const regex = /file:([^\s]+)/gi;
  let match = regex.exec(text);
  while (match) {
    hints.push(match[1]);
    match = regex.exec(text);
  }
  return hints;
}

function stripMarkers(text) {
  return text
    .replace(/\[task\]/gi, '')
    .replace(/#priority:[^\s]+/gi, '')
    .replace(/#due:[^\s]+/gi, '')
    .replace(/file:[^\s]+/gi, '')
    .trim();
}

function parseSlackTaskText(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    throw new Error('Missing task text. Expected: @user [task] description');
  }

  const parts = normalized.split(/\s+/);
  if (parts.length < 2) {
    throw new Error('Invalid task format. Expected: @user [task] description');
  }

  const assigneeToken = parts[0];
  const assigneeRef = extractSlackUserId(assigneeToken);
  if (!assigneeRef) {
    throw new Error(`Could not parse assignee from: ${assigneeToken}`);
  }

  const priority = parseTaggedValue(normalized, 'priority');
  const dueDate = parseTaggedValue(normalized, 'due');
  const linkedFiles = parseFileHints(normalized);

  const body = stripMarkers(parts.slice(1).join(' '));
  if (!body) {
    throw new Error('Task description is empty.');
  }

  const [titleCandidate, ...remaining] = body.split('—');
  const title = titleCandidate.trim().slice(0, 120);
  const description = remaining.length ? remaining.join('—').trim() : body;

  return {
    assigneeRef,
    description,
    dueDate,
    linkedFiles,
    priority,
    rawText: normalized,
    title
  };
}

function parseNudgeInput(text) {
  const normalized = String(text || '').trim();
  const parts = normalized.split(/\s+/);
  if (parts.length < 3) {
    throw new Error('Invalid nudge format. Expected: @user [file_path] [requirement]');
  }

  const slackUserId = extractSlackUserId(parts[0]);
  if (!slackUserId) {
    throw new Error(`Cannot parse Slack user from token: ${parts[0]}`);
  }

  return {
    description: parts.slice(2).join(' ').trim(),
    filePath: parts[1],
    slackUserId
  };
}

module.exports = {
  extractSlackUserId,
  parseNudgeInput,
  parseSlackTaskText
};
