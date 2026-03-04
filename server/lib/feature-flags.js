function asBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return Boolean(defaultValue);
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return Boolean(defaultValue);
}

function isTasksReadV2Enabled() {
  return asBoolean(process.env.TASKS_READ_V2, false);
}

function isTasksDualWriteEnabled() {
  return asBoolean(process.env.TASKS_DUAL_WRITE, false);
}

module.exports = {
  asBoolean,
  isTasksDualWriteEnabled,
  isTasksReadV2Enabled
};
