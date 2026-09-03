// Manager for the netmesh VPN companion (OpenbaseNetmeshCompanion.app), the
// headless app nested in our Resources that carries the SMAppService root
// daemon, bundled tailscaled, and netmesh-ctl — replacing the standalone
// Openbase Netmesh menu-bar app. Mirrors the screen-share companion
// conventions: spawn with --openbase-ipc-port/--openbase-ipc-secret, loopback
// HTTP with an x-openbase-companion-secret header.
//
// The VPN itself is a launchd daemon and survives this process; the companion
// only needs to run while the desktop app wants to issue control operations
// (replace-or-register / approve / connect / disconnect / status).
const crypto = require("node:crypto");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");

const DYNAMIC_IPC_PORT_MIN = 40000;
const DYNAMIC_IPC_PORT_MAX = 60999;

function companionIpcPort() {
  const configuredPortValue = process.env.OPENBASE_NETMESH_COMPANION_IPC_PORT;
  if (configuredPortValue) {
    const configuredPort = Number(configuredPortValue);
    if (Number.isInteger(configuredPort) && configuredPort > 0) {
      return configuredPort;
    }
  }
  return crypto.randomInt(DYNAMIC_IPC_PORT_MIN, DYNAMIC_IPC_PORT_MAX + 1);
}

function hasAsarPathSegment(candidate) {
  return path
    .normalize(candidate)
    .split(path.sep)
    .some((segment) => segment.endsWith(".asar"));
}

function isDirectory(candidate) {
  if (!candidate || hasAsarPathSegment(candidate)) {
    return false;
  }
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function companionAppCandidates(repoRoot) {
  return [
    process.env.OPENBASE_NETMESH_COMPANION_APP_PATH,
    process.resourcesPath
      ? path.join(process.resourcesPath, "OpenbaseNetmeshCompanion.app")
      : null,
    // Dev fallbacks: the in-repo netmesh-macos build products.
    path.join(repoRoot, "companion-build/OpenbaseNetmeshCompanion.app"),
    path.join(
      repoRoot,
      "netmesh-macos/DerivedData/Build/Products/Release/OpenbaseNetmeshCompanion.app",
    ),
    path.join(
      repoRoot,
      "netmesh-macos/DerivedData/Build/Products/Debug/OpenbaseNetmeshCompanion.app",
    ),
  ].filter(Boolean);
}

function findCompanionApp(repoRoot) {
  for (const candidate of companionAppCandidates(repoRoot)) {
    if (isDirectory(candidate)) {
      return candidate;
    }
  }
  return null;
}

function terminateCompanionProcesses() {
  const result = spawnSync("/usr/bin/pkill", ["-f", "OpenbaseNetmeshCompanion"], {
    encoding: "utf8",
  });
  if (result.status && result.status !== 1) {
    console.warn("[netmesh-companion] stale companion cleanup failed", {
      status: result.status,
      stderr: result.stderr?.trim(),
    });
  }
}

function requestJson({ port, secret, method = "GET", path: requestPath, body, timeout = 15000 }) {
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
          "content-type": "application/json",
          "content-length": payload.length,
          "x-openbase-companion-secret": secret,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            resolve(parsed);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("companion request timed out")));
    request.on("error", reject);
    if (payload.length) {
      request.write(payload);
    }
    request.end();
  });
}

function createNetmeshCompanionManager({ electronDir }) {
  const repoRoot = path.resolve(electronDir, "..");
  const port = companionIpcPort();
  const secret =
    process.env.OPENBASE_NETMESH_COMPANION_IPC_SECRET ||
    crypto.randomBytes(32).toString("hex");
  let launchProcess = null;

  async function rawStatus() {
    return requestJson({ port, secret, path: "/status", timeout: 4000 });
  }

  async function ensureRunning() {
    if (process.platform !== "darwin") {
      throw new Error("The netmesh VPN companion is macOS-only.");
    }
    try {
      return await rawStatus();
    } catch {
      // Not running yet — launch it below.
    }

    const companionAppPath = findCompanionApp(repoRoot);
    if (!companionAppPath) {
      throw new Error(
        "OpenbaseNetmeshCompanion.app was not found. Build it from the " +
          "netmesh-macos project (scripts/stage-netmesh-companion.mjs) or set " +
          "OPENBASE_NETMESH_COMPANION_APP_PATH.",
      );
    }

    terminateCompanionProcesses();
    console.info("[netmesh-companion] launch", { companionAppPath, port });

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
        secret,
      ],
      {
        env: { ...process.env, HOME: os.homedir() },
        stdio: "ignore",
        detached: true,
      },
    );
    launchProcess.on("error", (error) => {
      launchError = error;
      console.error("[netmesh-companion] launch spawn failed", { message: error.message });
    });
    launchProcess.unref();

    const deadline = Date.now() + 10000;
    let lastError = null;
    while (Date.now() < deadline) {
      if (launchError) {
        throw new Error(`Netmesh companion could not be launched: ${launchError.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
      try {
        return await rawStatus();
      } catch (error) {
        lastError = error.message;
      }
    }
    terminateCompanionProcesses();
    throw new Error(`Netmesh companion did not become ready: ${lastError || "unknown error"}`);
  }

  async function call(method, requestPath, body) {
    await ensureRunning();
    return requestJson({ port, secret, method, path: requestPath, body });
  }

  return {
    available: () => process.platform === "darwin" && Boolean(findCompanionApp(repoRoot)),
    status: async () => {
      try {
        return await call("GET", "/status");
      } catch (error) {
        return { ok: false, helper: "unavailable", error: error.message };
      }
    },
    // This explicit endpoint reads the running version before it considers a
    // helper-only unregister/register. It never disconnects the VPN engine.
    register: () => call("POST", "/replace-helper"),
    openApprovalSettings: () => call("POST", "/open-approval-settings"),
    connect: ({ controlURL, authKey, hostname }) =>
      call("POST", "/connect", { controlURL, authKey, hostname }),
    disconnect: () => call("POST", "/disconnect"),
    unregister: () => call("POST", "/unregister"),
    cleanup: () => {
      // The daemon (and VPN) intentionally outlives us; only the control
      // process is torn down.
      terminateCompanionProcesses();
    },
  };
}

module.exports = { createNetmeshCompanionManager };
