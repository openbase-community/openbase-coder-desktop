const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const LINUX_ONBOARDING_HELPER = "/usr/local/libexec/openbase-tailscale-onboard";
const LINUX_TAILSCALE_PATH = "/usr/bin/tailscale";
const SUDO_PATH = "/usr/bin/sudo";
const TAILSCALE_LOGIN_URL = /https:\/\/login\.tailscale\.com\/[^\s<>"']+/;
const MAX_OUTPUT_LENGTH = 16_384;
const READY_MARKER_NAME = "openbase-linux-tailscale-onboarding-ready";

function markLinuxTailscaleOnboardingReady({
  platform = process.platform,
  runtimeDir = process.env.XDG_RUNTIME_DIR,
  uid = process.getuid?.(),
  writeFile = fs.writeFileSync,
} = {}) {
  if (platform !== "linux") {
    return false;
  }
  const resolvedRuntimeDir = runtimeDir || `/run/user/${uid}`;
  writeFile(path.join(resolvedRuntimeDir, READY_MARKER_NAME), "ready\n", { mode: 0o600 });
  return true;
}

function appendBounded(current, chunk) {
  return `${current}${chunk}`.slice(-MAX_OUTPUT_LENGTH);
}

function friendlyFailure(output, code) {
  if (/password is required|a terminal is required|not allowed to execute/i.test(output)) {
    return "The workspace Tailscale privilege helper is unavailable. Rebuild the DevSpace from the latest AMI.";
  }
  const detail = output.replace(TAILSCALE_LOGIN_URL, "[Tailscale login URL]").trim();
  return detail
    ? `Tailscale onboarding failed: ${detail}`
    : `Tailscale onboarding exited with code ${code ?? "unknown"}.`;
}

function commandFailure(label, result) {
  const detail = (result.stderr || result.stdout || "").trim();
  return new Error(detail ? `${label} failed: ${detail}` : `${label} failed.`);
}

/**
 * Finish the Linux-only work that depends on an authenticated Tailscale node.
 *
 * The AMI helper makes the session owner the Tailscale operator, so these
 * fixed Serve commands need no further privilege escalation. Cloud reporting
 * records the measured health even when onboarding must surface a failure.
 */
async function runLinuxTailscalePostConnect({
  cliPath,
  platform = process.platform,
  runCommand,
} = {}) {
  if (platform !== "linux") {
    throw new Error("Linux Tailscale post-connect setup is available only on Linux.");
  }
  if (!cliPath || typeof runCommand !== "function") {
    throw new Error("Linux Tailscale post-connect setup is not configured.");
  }

  const commands = [
    {
      args: ["serve", "--bg", "--http=18080", "http://127.0.0.1:7999"],
      bin: LINUX_TAILSCALE_PATH,
      label: "Openbase API Tailscale Serve route",
    },
    {
      args: ["serve", "--bg", "--tcp=7880", "tcp://127.0.0.1:7880"],
      bin: LINUX_TAILSCALE_PATH,
      label: "LiveKit Tailscale Serve route",
    },
  ];
  for (const command of commands) {
    const result = await runCommand(command.bin, command.args);
    if (result.code !== 0) {
      throw commandFailure(command.label, result);
    }
  }

  const status = await runCommand(cliPath, ["onboarding", "status", "--json"]);
  if (status.code !== 0) {
    throw commandFailure("Tailscale Serve health check", status);
  }
  let payload;
  try {
    payload = JSON.parse(status.stdout);
  } catch {
    throw new Error("Tailscale Serve health check returned invalid output.");
  }
  const report = await runCommand(cliPath, ["onboarding", "report"]);
  if (report.code !== 0) {
    throw commandFailure("Openbase Cloud device registration", report);
  }
  if (payload?.tailscale_serve?.healthy !== true) {
    const detail = payload?.tailscale_serve?.error;
    throw new Error(
      detail
        ? `Tailscale Serve health check failed: ${detail}`
        : "Tailscale Serve health check failed.",
    );
  }
}

/**
 * Run the fixed, root-owned DevSpace helper and open only Tailscale's login URL.
 *
 * The platform argument is injectable so the non-Linux no-spawn guarantee can
 * be regression tested on every build host. Renderer input never reaches argv.
 */
function runLinuxTailscaleOnboarding({
  onConnected,
  openExternal,
  platform = process.platform,
  spawnProcess = spawn,
} = {}) {
  if (platform !== "linux") {
    return Promise.resolve({
      error: "Managed Tailscale onboarding is available only in Linux DevSpaces.",
      ok: false,
      supported: false,
    });
  }

  return new Promise((resolve) => {
    const child = spawnProcess(SUDO_PATH, ["-n", LINUX_ONBOARDING_HELPER], {
      env: { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let scanBuffer = "";
    let authUrl = null;
    let openPromise = Promise.resolve();
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const collect = (chunk) => {
      const text = chunk.toString();
      output = appendBounded(output, text);
      scanBuffer = appendBounded(scanBuffer, text);
      if (authUrl || typeof openExternal !== "function") {
        return;
      }
      const match = scanBuffer.match(TAILSCALE_LOGIN_URL);
      if (!match) {
        return;
      }
      authUrl = match[0];
      openPromise = Promise.resolve(openExternal(authUrl)).catch(() => undefined);
    };

    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", (error) => {
      finish({ error: error.message, ok: false, supported: true });
    });
    child.on("close", async (code, signal) => {
      await openPromise;
      if (code === 0) {
        try {
          await onConnected?.();
        } catch (error) {
          finish({
            authUrlOpened: Boolean(authUrl),
            error: `Tailscale connected, but Linux workspace setup failed: ${error.message}`,
            ok: false,
            registrationFailed: true,
            supported: true,
          });
          return;
        }
        finish({
          authUrlOpened: Boolean(authUrl),
          ok: true,
          registrationCompleted: typeof onConnected === "function",
          supported: true,
        });
        return;
      }
      finish({
        error: friendlyFailure(output, code),
        ok: false,
        signal: signal ?? null,
        supported: true,
      });
    });
  });
}

module.exports = {
  LINUX_ONBOARDING_HELPER,
  LINUX_TAILSCALE_PATH,
  markLinuxTailscaleOnboardingReady,
  READY_MARKER_NAME,
  runLinuxTailscalePostConnect,
  SUDO_PATH,
  runLinuxTailscaleOnboarding,
};
