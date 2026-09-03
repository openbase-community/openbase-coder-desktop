const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const CONTROL_FILE_PATH = path.join(os.homedir(), ".openbase", "desktop-control.json");

function writePrivateJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  const fd = fs.openSync(tempPath, "w", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tempPath, filePath);
  fs.chmodSync(filePath, 0o600);
}

function removeControlFile(filePath, secret) {
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (payload?.secret && payload.secret !== secret) {
      return;
    }
  } catch {
    // If the file is unreadable or partial, remove it only when this process is exiting.
  }

  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function readJsonRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error(`Invalid JSON request body: ${error.message}`));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": body.length,
  });
  response.end(body);
}

async function handleControlRequest({ request, response, secret, liveKitCompanion }) {
  if (request.headers["x-openbase-desktop-secret"] !== secret) {
    sendJson(response, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  try {
    if (request.method === "GET" && request.url === "/status") {
      sendJson(response, 200, {
        ok: true,
        companion: await liveKitCompanion.status(),
      });
      return;
    }

    if (request.method === "POST" && request.url === "/livekit-companion/start-screen-share") {
      const body = await readJsonRequest(request);
      const session = body.session && typeof body.session === "object" ? body.session : body;
      sendJson(response, 200, await liveKitCompanion.startScreenShare(session));
      return;
    }

    if (request.method === "POST" && request.url === "/livekit-companion/stop-screen-share") {
      sendJson(response, 200, await liveKitCompanion.stopScreenShare());
      return;
    }

    if (request.method === "POST" && request.url === "/computer-use/screenshot") {
      sendJson(response, 200, await liveKitCompanion.desktopControlRequest({ path: "/screenshot" }));
      return;
    }

    if (request.method === "POST" && request.url === "/computer-use/action") {
      const body = await readJsonRequest(request);
      sendJson(response, 200, await liveKitCompanion.desktopControlRequest({ path: "/action", body }));
      return;
    }

    if (request.method === "POST" && request.url === "/computer-use/open-app") {
      const body = await readJsonRequest(request);
      sendJson(response, 200, await liveKitCompanion.desktopControlRequest({ path: "/open-app", body }));
      return;
    }

    if (request.method === "GET" && request.url === "/computer-use/cursor") {
      sendJson(response, 200, await liveKitCompanion.desktopControlRequest({ method: "GET", path: "/cursor" }));
      return;
    }

    sendJson(response, 404, { ok: false, error: "Unknown desktop control route" });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message || String(error) });
  }
}

function createDesktopControlServer({ liveKitCompanion, logger }) {
  const secret = crypto.randomBytes(32).toString("hex");
  const server = http.createServer((request, response) => {
    void handleControlRequest({ request, response, secret, liveKitCompanion });
  });

  async function start() {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Desktop control server did not bind to a TCP port.");
    }

    // After a successful bind, later socket errors must not crash the main
    // process as an unhandled 'error' event.
    server.on("error", (error) => {
      logger.error("desktop-control-server-runtime-error", { message: error.message });
    });

    writePrivateJson(CONTROL_FILE_PATH, {
      pid: process.pid,
      port: address.port,
      secret,
      startedAt: new Date().toISOString(),
    });
    logger.info("desktop-control-server-started", {
      controlFilePath: CONTROL_FILE_PATH,
      port: address.port,
    });
    return { port: address.port };
  }

  function stop() {
    removeControlFile(CONTROL_FILE_PATH, secret);
    server.close();
  }

  return { start, stop };
}

module.exports = {
  CONTROL_FILE_PATH,
  createDesktopControlServer,
};
