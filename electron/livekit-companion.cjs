const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const DYNAMIC_IPC_PORT_MIN = 40000;
const DYNAMIC_IPC_PORT_MAX = 60999;
const COMPANION_IDENTITY = "openbase-screen-share-companion";
const COMPANION_NAME = "Openbase Screen Share";
const DEFAULT_COMPANION_LOG_PATH = path.join(
  os.homedir(),
  ".openbase",
  "logs",
  "livekit-companion.log",
);

function tokenFingerprint(token) {
  if (!token) return "missing";
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
}

function companionIpcPort() {
  const configuredPortValue = process.env.OPENBASE_LIVEKIT_COMPANION_IPC_PORT;
  if (configuredPortValue) {
    const configuredPort = Number(configuredPortValue);
    if (Number.isInteger(configuredPort) && configuredPort > 0) {
      return configuredPort;
    }

    console.warn("[livekit-companion] ignoring invalid IPC port override", {
      configuredPortValue,
    });
  }

  return crypto.randomInt(DYNAMIC_IPC_PORT_MIN, DYNAMIC_IPC_PORT_MAX + 1);
}

function repoRootFromElectronDir(electronDir) {
  return path.resolve(electronDir, "..");
}

function hasAsarPathSegment(candidate) {
  return path
    .normalize(candidate)
    .split(path.sep)
    .some((segment) => segment.endsWith(".asar"));
}

function isDirectory(candidate) {
  if (!candidate) {
    return false;
  }

  if (hasAsarPathSegment(candidate)) {
    return false;
  }

  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function packagedCompanionAppCandidates() {
  if (!process.resourcesPath) {
    return [];
  }

  return [
    path.join(process.resourcesPath, "OpenbaseScreenShareCompanion.app"),
    path.join(process.resourcesPath, "LiveKitExample.app"),
  ];
}

function defaultCompanionAppCandidates(repoRoot) {
  return [
    process.env.OPENBASE_LIVEKIT_COMPANION_APP_PATH,
    ...packagedCompanionAppCandidates(),
    path.join(
      repoRoot,
      "companion/livekit-swift-example/.derivedData/Build/Products/Debug/OpenbaseScreenShareCompanion.app",
    ),
    path.join(
      repoRoot,
      "companion/livekit-swift-example/build/Build/Products/Debug/OpenbaseScreenShareCompanion.app",
    ),
    path.join(repoRoot, "companion/livekit-swift-example/build/Debug/OpenbaseScreenShareCompanion.app"),
    path.join(
      repoRoot,
      "companion/livekit-swift-example/.derivedData/Build/Products/Debug/LiveKitExample.app",
    ),
  ].filter(Boolean);
}

function findCompanionApp(repoRoot) {
  for (const candidate of defaultCompanionAppCandidates(repoRoot)) {
    if (isDirectory(candidate)) {
      return candidate;
    }
  }

  return null;
}

function launchWorkingDirectory(repoRoot, companionAppPath) {
  const companionParentPath = path.dirname(companionAppPath);
  if (isDirectory(companionParentPath)) {
    return companionParentPath;
  }

  if (isDirectory(repoRoot)) {
    return repoRoot;
  }

  if (isDirectory(process.resourcesPath)) {
    return process.resourcesPath;
  }

  return path.dirname(companionAppPath);
}

function terminateCompanionProcesses() {
  const result = spawnSync("/usr/bin/pkill", ["-f", "OpenbaseScreenShareCompanion"], {
    encoding: "utf8",
  });

  if (result.status && result.status !== 1) {
    console.warn("[livekit-companion] stale companion cleanup failed", {
      error: result.error?.message,
      status: result.status,
      stderr: result.stderr?.trim(),
    });
  }
}

function requestJson({ port, ipcCapabilityToken, method = "GET", path: requestPath, body, timeout = 2500 }) {
  const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : Buffer.alloc(0);

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: requestPath,
        timeout,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payload.length,
          "X-Openbase-Companion-Secret": ipcCapabilityToken,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = {};
          if (text) {
            try {
              parsed = JSON.parse(text);
            } catch (error) {
              reject(new Error(`Companion returned invalid JSON: ${error.message}`));
              return;
            }
          }

          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(parsed.error || `Companion request failed: ${response.statusCode}`));
            return;
          }

          resolve(parsed);
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("Companion IPC request timed out"));
    });
    request.on("error", reject);

    if (payload.length > 0) {
      request.write(payload);
    }
    request.end();
  });
}

function createLiveKitCompanionManager({ electronDir, companionLogPath }) {
  const repoRoot = repoRootFromElectronDir(electronDir);
  const resolvedCompanionLogPath =
    companionLogPath ||
    process.env.OPENBASE_LIVEKIT_COMPANION_LOG_PATH ||
    DEFAULT_COMPANION_LOG_PATH;
  const port = companionIpcPort();
  const ipcCapabilityToken =
    process.env.OPENBASE_LIVEKIT_COMPANION_IPC_SECRET ||
    crypto.randomBytes(32).toString("hex");
  let launchProcess = null;
  let lastStatus = "off";

  async function status() {
    try {
      const response = await requestJson({ port, ipcCapabilityToken, path: "/status" });
      lastStatus = response.state || lastStatus;
      return response;
    } catch (error) {
      return {
        ok: false,
        state: lastStatus === "sharing" ? "error" : "off",
        error: error.message,
      };
    }
  }

  async function ensureRunning() {
    const existing = await status();
    if (existing.ok) {
      return existing;
    }

    const companionAppPath = findCompanionApp(repoRoot);
    if (!companionAppPath) {
      const searched = defaultCompanionAppCandidates(repoRoot).join(", ");
      throw new Error(
        `LiveKit companion app bundle was not found. Build it in Xcode first or set OPENBASE_LIVEKIT_COMPANION_APP_PATH. Searched: ${searched}`,
      );
    }

    fs.mkdirSync(path.dirname(resolvedCompanionLogPath), { recursive: true });
    fs.closeSync(fs.openSync(resolvedCompanionLogPath, "a"));

    const companionCwd = launchWorkingDirectory(repoRoot, companionAppPath);
    terminateCompanionProcesses();
    console.info("[livekit-companion] launch", {
      companionAppPath,
      companionLogPath: resolvedCompanionLogPath,
      cwd: companionCwd,
      ipcCapabilityFingerprint: tokenFingerprint(ipcCapabilityToken),
      port,
    });

    let launchError = null;
    launchProcess = spawn(
      "/usr/bin/open",
      [
        "-n",
        companionAppPath,
        "--args",
        "--openbase-ipc-port",
        String(port),
        "--openbase-ipc-secret",
        ipcCapabilityToken,
        "--openbase-log-path",
        resolvedCompanionLogPath,
      ],
      {
        cwd: companionCwd,
        env: {
          ...process.env,
          HOME: os.homedir(),
          OPENBASE_LIVEKIT_COMPANION_LOG_PATH: resolvedCompanionLogPath,
        },
        stdio: "ignore",
        detached: true,
      },
    );
    // Without a listener, a spawn failure would be raised as an unhandled
    // 'error' event and crash the main process instead of reaching the caller.
    launchProcess.on("error", (error) => {
      launchError = error;
      console.error("[livekit-companion] launch spawn failed", { message: error.message });
    });
    launchProcess.unref();

    const deadline = Date.now() + 10000;
    let lastError = null;
    while (Date.now() < deadline) {
      if (launchError) {
        throw new Error(`LiveKit companion could not be launched: ${launchError.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
      const response = await status();
      if (response.ok) {
        return response;
      }
      lastError = response.error;
    }

    terminateCompanionProcesses();
    throw new Error(`LiveKit companion did not become ready: ${lastError || "unknown error"}`);
  }

  async function startScreenShare(session) {
    if (!session || !session.roomUrl || !session.companionToken) {
      throw new Error("Missing LiveKit room URL or companion token");
    }

    console.info("[livekit-companion] start-screen-share request", {
      roomUrl: session.roomUrl,
      tokenFingerprint: tokenFingerprint(session.companionToken),
      tokenExpiresAt: session.companionTokenExpiresAt || null,
      identity: COMPANION_IDENTITY,
    });

    await ensureRunning();
    const response = await requestJson({
      port,
      ipcCapabilityToken,
      method: "POST",
      path: "/screen-share/start",
      body: {
        roomUrl: session.roomUrl,
        token: session.companionToken,
        identity: COMPANION_IDENTITY,
        name: COMPANION_NAME,
        sourceType: "display",
      },
    });
    lastStatus = response.state || "sharing";
    console.info("[livekit-companion] start-screen-share response", {
      ok: response.ok,
      state: response.state,
    });
    return response;
  }

  async function stopScreenShare() {
    console.info("[livekit-companion] stop-screen-share request");
    await ensureRunning();
    const response = await requestJson({
      port,
      ipcCapabilityToken,
      method: "POST",
      path: "/screen-share/stop",
      body: {},
    });
    lastStatus = response.state || "off";
    console.info("[livekit-companion] stop-screen-share response", {
      ok: response.ok,
      state: response.state,
    });
    return response;
  }

  async function desktopControlRequest({ method = "POST", path: requestPath, body }) {
    await ensureRunning();
    // Screenshots and app launches can exceed the default IPC timeout.
    return await requestJson({
      port,
      ipcCapabilityToken,
      method,
      path: `/desktop-control${requestPath}`,
      body,
      timeout: 15000,
    });
  }

  return {
    cleanup: terminateCompanionProcesses,
    desktopControlRequest,
    startScreenShare,
    stopScreenShare,
    status,
  };
}

module.exports = {
  COMPANION_IDENTITY,
  createLiveKitCompanionManager,
};
