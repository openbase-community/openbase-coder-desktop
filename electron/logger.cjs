const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const util = require("node:util");
const { sanitizeForLog } = require("./log-sanitize.cjs");

const LOG_DIR = path.join(os.homedir(), ".openbase", "logs");
const MAIN_LOG_PATH = path.join(LOG_DIR, "electron-main.log");
const RENDERER_LOG_PATH = path.join(LOG_DIR, "electron-renderer.log");
const COMPANION_LOG_PATH = path.join(LOG_DIR, "livekit-companion.log");

function ensureLogFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.closeSync(fs.openSync(filePath, "a"));
}

function formatArgs(args) {
  return args
    .map((arg) => {
      const sanitized = sanitizeForLog(arg);
      if (typeof sanitized === "string") {
        return sanitized;
      }
      return util.inspect(sanitized, {
        breakLength: Infinity,
        compact: true,
        depth: 6,
        sorted: true,
      });
    })
    .join(" ");
}

function appendLogLine(filePath, label, level, args) {
  ensureLogFile(filePath);
  const timestamp = new Date().toISOString();
  fs.appendFileSync(filePath, `[${timestamp}] [${label}] [${level}] ${formatArgs(args)}\n`);
}

function createFileLogger(label, filePath) {
  ensureLogFile(filePath);

  function write(level, ...args) {
    appendLogLine(filePath, label, level, args);
  }

  return {
    debug: (...args) => write("debug", ...args),
    info: (...args) => write("info", ...args),
    log: (...args) => write("log", ...args),
    warn: (...args) => write("warn", ...args),
    error: (...args) => write("error", ...args),
    write,
  };
}

function installConsoleFileLogger(label, filePath) {
  const fileLogger = createFileLogger(label, filePath);
  const originalConsole = {};

  for (const level of ["debug", "info", "log", "warn", "error"]) {
    originalConsole[level] = console[level].bind(console);
    console[level] = (...args) => {
      originalConsole[level](...args);
      try {
        fileLogger.write(level, ...args);
      } catch (error) {
        originalConsole.error("[openbase-logger] failed to write log", error);
      }
    };
  }

  return fileLogger;
}

ensureLogFile(MAIN_LOG_PATH);
ensureLogFile(RENDERER_LOG_PATH);
ensureLogFile(COMPANION_LOG_PATH);

module.exports = {
  COMPANION_LOG_PATH,
  LOG_DIR,
  MAIN_LOG_PATH,
  RENDERER_LOG_PATH,
  createFileLogger,
  ensureLogFile,
  installConsoleFileLogger,
  sanitizeForLog,
};
