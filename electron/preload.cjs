const { contextBridge, ipcRenderer } = require("electron");

// Exact copy of electron/log-sanitize.cjs: the sandboxed preload (Electron
// sandboxes preloads by default with nodeIntegration disabled) cannot
// require local modules, so keep this in sync with that file.
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

function sendRendererLog(level, payload) {
  try {
    ipcRenderer.send("openbase:renderer-log", {
      ...payload,
      level,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Never let logging itself crash the window/unhandledrejection listeners;
    // keep the original failure visible in the DevTools console at least.
    console.error("[openbase-preload] failed to forward renderer log", error, payload);
  }
}

const backendArg = process.argv.find((arg) =>
  arg.startsWith("--openbase-backend-base-url=")
);

// main.cjs always supplies --openbase-backend-base-url (defaulted from
// electron/runtime-defaults.json, which the sandboxed preload cannot
// require); if it is ever missing, the renderer falls back to that same
// shared default.
const backendBaseUrl = backendArg
  ? backendArg.split("=").slice(1).join("=")
  : undefined;

contextBridge.exposeInMainWorld("__OPENBASE_RUNTIME_CONFIG__", {
  backendBaseUrl,
  shell: "electron",
});

contextBridge.exposeInMainWorld("__OPENBASE_SHELL__", {
  openExternal(url) {
    return ipcRenderer.invoke("openbase:shell:open-external", url);
  },
});

contextBridge.exposeInMainWorld("__OPENBASE_LIVEKIT_COMPANION__", {
  startScreenShare(session) {
    return ipcRenderer.invoke("openbase:livekit-companion:start-screen-share", session);
  },
  stopScreenShare() {
    return ipcRenderer.invoke("openbase:livekit-companion:stop-screen-share");
  },
  status() {
    return ipcRenderer.invoke("openbase:livekit-companion:status");
  },
});

contextBridge.exposeInMainWorld("__OPENBASE_INSTALLER__", {
  platform: process.platform,
  check() {
    return ipcRenderer.invoke("openbase:installer:check");
  },
  start(commandId, options) {
    return ipcRenderer.invoke("openbase:installer:start", commandId, options);
  },
  cancel() {
    return ipcRenderer.invoke("openbase:installer:cancel");
  },
  openTailscaleDownload() {
    return ipcRenderer.invoke("openbase:installer:open-tailscale-download");
  },
  openTailscaleApp() {
    return ipcRenderer.invoke("openbase:installer:open-tailscale-app");
  },
  tailscaleIdentity() {
    return ipcRenderer.invoke("openbase:onboarding:tailscale-identity");
  },
  connectLinuxTailscale() {
    return ipcRenderer.invoke("openbase:onboarding:linux-tailscale-connect");
  },
  onboardingFlags() {
    return ipcRenderer.invoke("openbase:onboarding:flags");
  },
  setOnboardingFlag(key, value) {
    return ipcRenderer.invoke("openbase:onboarding:set-flag", key, value);
  },
  onEvent(callback) {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on("openbase:installer:event", listener);
    return () => {
      ipcRenderer.removeListener("openbase:installer:event", listener);
    };
  },
});

contextBridge.exposeInMainWorld("__OPENBASE_APP_UPDATES__", {
  check() {
    return ipcRenderer.invoke("openbase:app-update:check");
  },
  quitAndInstall() {
    return ipcRenderer.invoke("openbase:app-update:quit-and-install");
  },
  status() {
    return ipcRenderer.invoke("openbase:app-update:status");
  },
  onEvent(callback) {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on("openbase:app-update:event", listener);
    return () => {
      ipcRenderer.removeListener("openbase:app-update:event", listener);
    };
  },
});

contextBridge.exposeInMainWorld("__OPENBASE_DESKTOP_CONTROL__", {
  status() {
    return ipcRenderer.invoke("openbase:desktop-control:status");
  },
  onEvent(callback) {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on("openbase:desktop-control:event", listener);
    return () => {
      ipcRenderer.removeListener("openbase:desktop-control:event", listener);
    };
  },
});

contextBridge.exposeInMainWorld("__OPENBASE_DEEP_LINKS__", {
  onOpen(callback) {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on("openbase:deep-link", listener);
    void ipcRenderer.invoke("openbase:deep-link:ready");
    return () => {
      ipcRenderer.removeListener("openbase:deep-link", listener);
    };
  },
});

window.addEventListener("error", (event) => {
  sendRendererLog("error", {
    column: event.colno,
    error: sanitizeForLog(event.error),
    line: event.lineno,
    message: event.message,
    source: event.filename,
    type: "window-error",
  });
});

window.addEventListener("unhandledrejection", (event) => {
  sendRendererLog("error", {
    reason: sanitizeForLog(event.reason),
    type: "unhandled-rejection",
  });
});

sendRendererLog("info", {
  backendBaseUrl,
  shell: "electron",
  type: "preload-ready",
});
