// Duplicated in electron/preload.cjs: the sandboxed preload cannot require
// local modules, so keep the copy there in sync with this file.
const REDACTED = "[redacted]";
const SENSITIVE_KEY_PATTERN = /(authorization|credential|password|secret|token|api[-_]?key)/i;

function sanitizeForLog(value, key = "", depth = 0, maxDepth = 5) {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (depth >= maxDepth) {
    return "[max-depth]";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForLog(entry, "", depth + 1, maxDepth));
  }

  const sanitized = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    sanitized[entryKey] = sanitizeForLog(entryValue, entryKey, depth + 1, maxDepth);
  }
  return sanitized;
}

module.exports = {
  REDACTED,
  SENSITIVE_KEY_PATTERN,
  sanitizeForLog,
};
