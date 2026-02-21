function parseNudgeInput(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    throw new Error('Missing nudge command text. Expected: @user [file_path] [requirement]');
  }

  const parts = normalized.split(/\s+/);
  if (parts.length < 3) {
    throw new Error('Invalid nudge format. Expected: @user [file_path] [requirement]');
  }

  const userToken = parts[0];
  const filePath = parts[1];
  const description = parts.slice(2).join(' ').trim();

  if (!description) {
    throw new Error('Missing requirement text.');
  }

  const slackUserId = extractSlackUserId(userToken);
  if (!slackUserId) {
    throw new Error(`Cannot parse Slack user from token: ${userToken}`);
  }

  return {
    slackUserId,
    filePath,
    description
  };
}

function extractSlackUserId(token) {
  const mentionMatch = token.match(/^<@([A-Z0-9]+)(?:\|[^>]+)?>$/i);
  if (mentionMatch) {
    return mentionMatch[1];
  }

  if (token.startsWith('@')) {
    return token.slice(1);
  }

  return undefined;
}

module.exports = {
  extractSlackUserId,
  parseNudgeInput
};
