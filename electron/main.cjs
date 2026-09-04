const { app, BrowserWindow, ipcMain, session, shell, systemPreferences } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createDesktopControlServer } = require("./desktop-control-server.cjs");
const { isDeveloperDashboardOnly } = require("./developer-dashboard.cjs");
const { maybeMigrateLegacyAppBundle } = require("./app-brand-migration.cjs");
const { maybeOfferInstallerCleanup } = require("./installer-cleanup.cjs");
const {
  markLinuxTailscaleOnboardingReady,
  runLinuxTailscaleOnboarding,
  runLinuxTailscalePostConnect,
} = require("./linux-tailscale-onboarding.cjs");
const { createLiveKitCompanionManager } = require("./livekit-companion.cjs");
const { createNetmeshCompanionManager } = require("./netmesh-companion.cjs");
const { sendInstallerEvent } = require("./installer-events.cjs");
const { createSingleFlight } = require("./single-flight.cjs");
const {
  COMPANION_LOG_PATH,
  LOG_DIR,
  MAIN_LOG_PATH,
  RENDERER_LOG_PATH,
  createFileLogger,
  installConsoleFileLogger,
} = require("./logger.cjs");

// Shared with the renderer bundle (src imports the same JSON files) so the
// installer command registry and default backend URL have a single source.
const INSTALLER_COMMANDS = require("./installer-commands.json");
const RUNTIME_DEFAULTS = require("./runtime-defaults.json");
const APP_PACKAGE = require("../package.json");

// Keep the established data location even though the visible product name is
// now Openbase. This preserves auth state, updater identity, and one-time
// installer decisions across the rebrand.
app.setPath("userData", path.join(app.getPath("appData"), "Openbase Coder"));

// Unpackaged runs inherit Electron's bundle name; the icon is set at runtime
// below, and this at least corrects the about panel and app menus.
app.setName("Openbase");

const rendererUrl = process.env.OPENBASE_CODER_DESKTOP_RENDERER_URL;
const backendBaseUrl =
  process.env.OPENBASE_CODER_DESKTOP_BACKEND_URL || RUNTIME_DEFAULTS.backendBaseUrl;
let activeInstallation = null;
try {
  activeInstallation = JSON.parse(
    fs.readFileSync(path.join(os.homedir(), ".openbase", "installation.json"), "utf8"),
  );
} catch {
  // First production launch has no installation yet; onboarding stays enabled.
}
const developerDashboardOnly = isDeveloperDashboardOnly({
  appPackaged: app.isPackaged,
  envValue: process.env.OPENBASE_DESKTOP_DEV_DASHBOARD_ONLY,
  installation: activeInstallation,
});
const appIconPath = path.join(__dirname, "..", "assets", "openbase-coder-icon.png");
const mainLogger = installConsoleFileLogger("electron-main", MAIN_LOG_PATH);
const rendererLogger = createFileLogger("electron-renderer", RENDERER_LOG_PATH);
const liveKitCompanion = createLiveKitCompanionManager({
  companionLogPath: COMPANION_LOG_PATH,
  electronDir: __dirname,
});
const netmeshCompanion = createNetmeshCompanionManager({ electronDir: __dirname });
let installerProcess = null;
let linuxTailscaleOnboardingPromise = null;
let desktopControlServer = null;
let mainWindow = null;
const pendingDeepLinks = [];
let rendererDeepLinkReady = false;
const DEEP_LINK_PROTOCOL = "openbase-coder";
const gotSingleInstanceLock = app.requestSingleInstanceLock();

const IS_WINDOWS = process.platform === "win32";

const GUI_SHELL_PATHS = IS_WINDOWS
  ? [
      path.join(os.homedir(), ".openbase", "bin"),
      path.join(os.homedir(), ".local", "bin"),
      path.join(os.homedir(), ".cargo", "bin"),
      "C:\\Program Files\\Tailscale",
    ]
  : [
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      path.join(os.homedir(), ".local", "bin"),
      path.join(os.homedir(), ".cargo", "bin"),
    ];

// Default macOS Tailscale install path: the Mac App Store variant (see
// src/onboarding/config.ts TAILSCALE_MAC_APP_STORE_URL for the rationale).
const TAILSCALE_MAC_APP_STORE_URL =
  "https://apps.apple.com/us/app/tailscale/id1475387142";

const SHELL_INIT_COMMAND = [
  'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
  '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
].join("\n");

function installerEnv() {
  const existingPath = process.env.PATH || "";
  const pathParts = [...GUI_SHELL_PATHS, existingPath]
    .flatMap((entry) => entry.split(path.delimiter))
    .filter(Boolean);
  return {
    ...process.env,
    PATH: [...new Set(pathParts)].join(path.delimiter),
  };
}

function shellCommand(command) {
  return `${SHELL_INIT_COMMAND}\n${command}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

// Login shell used for CLI/prerequisite lookups so the user's PATH (uv tools,
// ~/.local/bin) is in scope. macOS ships zsh; Linux devspaces ship bash.
const LOGIN_SHELL = process.platform === "linux" ? "/bin/bash" : "/bin/zsh";

function shellCommandFromArgs(bin, args) {
  return shellCommand([bin, ...args].map(shellQuote).join(" "));
}

function shellCapture(command) {
  return new Promise((resolve) => {
    const child = spawn(LOGIN_SHELL, ["-lc", shellCommand(command)], {
      env: installerEnv(),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ code: null, stderr: error.message, stdout: "" });
    });
    child.on("close", (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}

// Windows has no POSIX login shell, so argv-shaped commands spawn directly
// there; macOS/Linux keep the login shell so the user's PATH (uv tools,
// ~/.local/bin, nvm) stays in scope.
function captureSpawn(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env: installerEnv(), windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ code: null, stderr: error.message, stdout: "" });
    });
    child.on("close", (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}

function runArgv(bin, args) {
  if (IS_WINDOWS) {
    return captureSpawn(bin, args);
  }
  return shellCapture(shellCommandFromArgs(bin, args));
}

const OPENBASE_BASE_DIR = process.env.OPENBASE_CODER_HOME || path.join(os.homedir(), ".openbase");
const STANDALONE_PACKAGE_ROOT = path.join(OPENBASE_BASE_DIR, "packages", "standalone");
const STANDALONE_RELEASES_DIR = path.join(STANDALONE_PACKAGE_ROOT, "releases");
const STANDALONE_CURRENT_LINK = path.join(STANDALONE_PACKAGE_ROOT, "current");
const BUNDLED_CLI_RESOURCE_NAME = "OpenbaseCoderCLI";
const PACKAGE_METADATA_FILENAME = "openbase-coder-package.json";
const OPENBASE_CLI_BIN_NAME = process.platform === "win32" ? "openbase-coder.exe" : "openbase-coder";

function cliPathForPackage(packageRoot) {
  return path.join(packageRoot, "bin", OPENBASE_CLI_BIN_NAME);
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readPackageMetadata(packageRoot) {
  try {
    const metadataPath = path.join(packageRoot, PACKAGE_METADATA_FILENAME);
    const metadata = JSON.parse(await fsp.readFile(metadataPath, "utf8"));
    if (!(await pathExists(cliPathForPackage(packageRoot)))) {
      return null;
    }
    return {
      target: String(metadata.target || `${process.platform}-${process.arch}`),
      version: String(metadata.version || app.getVersion()),
    };
  } catch {
    return null;
  }
}

function releaseNameForPackage(metadata) {
  return `${metadata.version}-${metadata.target}`.replace(/[^A-Za-z0-9._-]/g, "-");
}

async function bundledCliPackage() {
  const candidates = [
    process.env.OPENBASE_CODER_DESKTOP_CLI_PACKAGE_DIR,
    process.env.OPENBASE_CODER_STANDALONE_PACKAGE_DIR,
    path.join(process.resourcesPath || "", BUNDLED_CLI_RESOURCE_NAME),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const packageRoot = path.resolve(candidate);
    const metadata = await readPackageMetadata(packageRoot);
    if (metadata) {
      return { metadata, packageRoot };
    }
  }
  return null;
}

async function copyPackage(sourceRoot, targetRoot) {
  const tempRoot = `${targetRoot}.staging-${process.pid}-${Date.now()}`;
  await fsp.rm(tempRoot, { force: true, recursive: true });
  await fsp.mkdir(path.dirname(targetRoot), { recursive: true });
  await fsp.cp(sourceRoot, tempRoot, {
    dereference: false,
    preserveTimestamps: true,
    recursive: true,
  });
  await fsp.chmod(cliPathForPackage(tempRoot), 0o755);
  const livekitPath = path.join(tempRoot, "bin", process.platform === "win32" ? "livekit-server.exe" : "livekit-server");
  if (await pathExists(livekitPath)) {
    await fsp.chmod(livekitPath, 0o755);
  }
  await fsp.rm(targetRoot, { force: true, recursive: true });
  await fsp.rename(tempRoot, targetRoot);
}

async function pointCurrentAt(targetRoot) {
  await fsp.mkdir(STANDALONE_PACKAGE_ROOT, { recursive: true });
  await fsp.rm(STANDALONE_CURRENT_LINK, { force: true, recursive: true });
  // Real symlinks need admin/developer-mode on Windows; a directory
  // junction resolves the same way for our purposes and never prompts.
  await fsp.symlink(targetRoot, STANDALONE_CURRENT_LINK, IS_WINDOWS ? "junction" : "dir");
}

async function activateBundledCliPackageOnce() {
  // Forward-only activation (AUTO_UPDATE.md): the bundled package is a
  // first-install seed only. Once `current` resolves to a valid install, the
  // release feed is the sole authority for what `current` points at — never
  // copy the seed again or re-point `current` back at it (that would silently
  // downgrade a self-updated install).
  const activeMetadata = await readPackageMetadata(STANDALONE_CURRENT_LINK);
  if (activeMetadata) {
    return {
      activated: true,
      cliPath: cliPathForPackage(STANDALONE_CURRENT_LINK),
      detail: `Openbase Coder CLI ${activeMetadata.version} is already activated.`,
      metadata: activeMetadata,
      source: "activated",
    };
  }

  const bundled = await bundledCliPackage();
  if (!bundled) {
    return { activated: false, detail: "No bundled Openbase CLI package was found." };
  }

  const releaseName = releaseNameForPackage(bundled.metadata);
  const targetRoot = path.join(STANDALONE_RELEASES_DIR, releaseName);
  const alreadyStaged = await readPackageMetadata(targetRoot);
  if (!alreadyStaged) {
    mainLogger.info("desktop-cli-activate-copy", {
      sourceRoot: bundled.packageRoot,
      targetRoot,
    });
    await copyPackage(bundled.packageRoot, targetRoot);
  }
  await pointCurrentAt(targetRoot);
  // Hand back the stable `current` path (not the versioned release dir) so
  // downstream consumers keep working after future self-updates re-point it.
  return {
    activated: true,
    cliPath: cliPathForPackage(STANDALONE_CURRENT_LINK),
    detail: `Activated bundled Openbase CLI ${bundled.metadata.version}.`,
    metadata: bundled.metadata,
    source: "bundled",
  };
}

const activateBundledCliPackage = createSingleFlight(activateBundledCliPackageOnce);

// The login-shell PATH lookup costs 1-2s per call; the result cannot change
// within a run, so resolve it once.
let cachedDevCliPath = null;

async function resolveOpenbaseCoderCli({ activateBundled = true } = {}) {
  let activationError = null;
  // A development installation's single source of truth is the workspace CLI
  // on PATH. Never activate the bundled package there, and don't let a stale
  // activated standalone package (whose runtime may be long gone) shadow it.
  if (developerDashboardOnly) {
    const devDetail = "Using the development workspace openbase-coder on PATH.";
    if (cachedDevCliPath) {
      return { detail: devDetail, path: cachedDevCliPath, source: "path" };
    }
    const devPathResult = IS_WINDOWS
      ? await captureSpawn("where", ["openbase-coder"])
      : await shellCapture("command -v openbase-coder");
    const devPathCli = devPathResult.stdout.trim().split(/\r?\n/)[0];
    if (devPathResult.code === 0 && devPathCli) {
      cachedDevCliPath = devPathCli;
      return { detail: devDetail, path: devPathCli, source: "path" };
    }
    activateBundled = false;
  }
  if (activateBundled) {
    try {
      const activation = await activateBundledCliPackage();
      if (activation.activated && activation.cliPath) {
        return {
          detail: activation.detail,
          path: activation.cliPath,
          source: activation.source,
        };
      }
    } catch (error) {
      // Activation failing (disk full, permissions, …) must not mask a CLI
      // that is already activated or on PATH; surface it in the detail below.
      activationError = error.message;
      mainLogger.error("bundled-cli-activation-error", { message: error.message });
    }
  }

  const activeCliPath = cliPathForPackage(STANDALONE_CURRENT_LINK);
  if (await pathExists(activeCliPath)) {
    return {
      detail: "Using activated Openbase CLI package.",
      path: activeCliPath,
      source: "activated",
    };
  }

  const pathResult = IS_WINDOWS
    ? await captureSpawn("where", ["openbase-coder"])
    : await shellCapture("command -v openbase-coder");
  const pathCli = pathResult.stdout.trim().split(/\r?\n/)[0];
  if (pathResult.code === 0 && pathCli) {
    return {
      detail: "Using openbase-coder found on PATH.",
      path: pathCli,
      source: "path",
    };
  }

  return {
    detail: [
      activationError ? `Activating the bundled CLI failed: ${activationError}` : null,
      "No bundled or installed Openbase CLI was found. Rebuild the desktop app with a bundled standalone package, or install the CLI manually.",
    ]
      .filter(Boolean)
      .join(" — "),
    path: "",
    source: "missing",
  };
}

async function cliVersionDetail(cliPath) {
  if (!cliPath) {
    return "";
  }
  const result = await runArgv(cliPath, ["--version"]);
  return (result.stdout || result.stderr).trim();
}

async function checkInstallerPrerequisites() {
  const openbaseCoder = await resolveOpenbaseCoderCli();
  const openbaseCoderVersion = await cliVersionDetail(openbaseCoder.path);

  return {
    platform: process.platform,
    prerequisites: [
      {
        id: "platform",
        label: "Operating system",
        ok:
          process.platform === "darwin" ||
          process.platform === "linux" ||
          IS_WINDOWS,
        detail:
          process.platform === "darwin"
            ? "This Mac can use launchd services."
            : process.platform === "linux"
              ? "This Linux machine can use systemd services."
              : IS_WINDOWS
                ? "This Windows machine can use the Windows service backend."
                : "Openbase setup expects macOS, Linux, or Windows.",
      },
      {
        id: "openbase-coder",
        label: "Openbase CLI",
        ok: Boolean(openbaseCoder.path),
        detail:
          [openbaseCoderVersion, openbaseCoder.detail].filter(Boolean).join(" — ") ||
          "Activate the bundled standalone CLI package before running setup.",
      },
      {
        id: "private-network",
        label: "Private networking",
        ok: false,
        detail: "Choose Openbase VPN or Openbase Direct before setup.",
      },
    ],
  };
}

// The Tailscale identity check is implemented once, in the CLI
// (tailscale_self in `openbase-coder onboarding status`). This is the
// pre-backend access path to it: run the CLI binary and hand its
// tailscale_self block to the renderer, which reads the same block from the
// HTTP status payload once the backend is healthy. Note the CLI call also
// validates cloud auth, so pre-backend identity polls should stay confined
// to the pages that need them.
async function readTailscaleSelfViaCli() {
  const cli = await resolveOpenbaseCoderCli();
  if (!cli.path) {
    return { ok: false, error: cli.detail };
  }
  const result = await runArgv(cli.path, ["onboarding", "status", "--json"]);
  const stdout = result.stdout || "";
  const jsonStart = stdout.indexOf("{");
  if (result.code !== 0 || jsonStart === -1) {
    return {
      ok: false,
      error:
        (result.stderr || stdout).trim() ||
        "Could not read onboarding status from the Openbase CLI.",
    };
  }
  try {
    const payload = JSON.parse(stdout.slice(jsonStart));
    return { ok: true, self: payload.tailscale_self ?? null };
  } catch (error) {
    return {
      ok: false,
      error: `Could not parse CLI onboarding status: ${error.message}`,
    };
  }
}

async function readTailnetConfigViaCli() {
  const cli = await resolveOpenbaseCoderCli();
  if (!cli.path) {
    return { ok: false, error: cli.detail };
  }
  const result = await runArgv(cli.path, ["onboarding", "status", "--json"]);
  const stdout = result.stdout || "";
  const jsonStart = stdout.indexOf("{");
  if (result.code !== 0 || jsonStart === -1) {
    return {
      ok: false,
      error:
        (result.stderr || stdout).trim() ||
        "Could not read tailnet configuration from the Openbase CLI.",
    };
  }
  try {
    const payload = JSON.parse(stdout.slice(jsonStart));
    const tailnet = payload.tailnet;
    if (!tailnet || typeof tailnet !== "object") {
      return { ok: false, error: "This Openbase CLI does not report tailnet choices." };
    }
    return { ok: true, ...tailnet };
  } catch (error) {
    return { ok: false, error: `Could not parse CLI onboarding status: ${error.message}` };
  }
}

const SETUP_BACKENDS = new Set(["codex", "claude-code", "openbase-cloud"]);
const SETUP_AUDIO_PROVIDERS = new Set(["openbase-cloud", "cartesia", "local"]);
// The three tailnet transports (three different networks — the fleet must
// agree; the CLI records the choice account-side and orchestrates locally).
const TAILNET_PROVIDERS = new Set(["tailscale", "netmesh", "netmesh-tsnet"]);

function parseDeepLink(rawUrl) {
  if (typeof rawUrl !== "string") {
    return null;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    mainLogger.warn("deep-link-invalid-url");
    return null;
  }

  if (parsedUrl.protocol !== `${DEEP_LINK_PROTOCOL}:`) {
    return null;
  }

  const action = parsedUrl.hostname || parsedUrl.pathname.replace(/^\/+/, "") || "open";
  const intent = parsedUrl.searchParams.get("intent") || "open";
  const source = parsedUrl.searchParams.get("source") || "unknown";
  return { action, intent, source };
}

function deepLinkArg(argv) {
  return argv.find((arg) => arg.startsWith(`${DEEP_LINK_PROTOCOL}:`));
}

function flushPendingDeepLinks() {
  if (
    !rendererDeepLinkReady ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindow.webContents.isLoading()
  ) {
    return;
  }

  while (pendingDeepLinks.length > 0) {
    const payload = pendingDeepLinks.shift();
    mainLogger.info("deep-link-dispatch", payload);
    mainWindow.webContents.send("openbase:deep-link", payload);
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (app.isReady()) {
      createWindow();
    }
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function handleDeepLink(rawUrl) {
  const payload = parseDeepLink(rawUrl);
  if (!payload) {
    return;
  }

  pendingDeepLinks.push(payload);
  focusMainWindow();
  flushPendingDeepLinks();
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const url = deepLinkArg(argv);
    if (url) {
      handleDeepLink(url);
      return;
    }
    focusMainWindow();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

async function commandWithOptions(commandId, options = {}) {
  const command = INSTALLER_COMMANDS[commandId];
  if (!command) {
    return null;
  }
  if (command.internal) {
    return command;
  }

  let args = command.args;
  if (commandId === "setup") {
    const backend = typeof options.backend === "string" ? options.backend : "codex";
    if (!SETUP_BACKENDS.has(backend)) {
      throw new Error(`Unsupported setup backend: ${backend}`);
    }
    const audioProvider =
      typeof options.audioProvider === "string" ? options.audioProvider : "openbase-cloud";
    if (!SETUP_AUDIO_PROVIDERS.has(audioProvider)) {
      throw new Error(`Unsupported setup audio provider: ${audioProvider}`);
    }
    args = [...command.args, "--backend", backend, "--audio-provider", audioProvider];
    if (typeof options.tailnetProvider === "string") {
      if (!TAILNET_PROVIDERS.has(options.tailnetProvider)) {
        throw new Error(`Unsupported tailnet provider: ${options.tailnetProvider}`);
      }
      args = [...args, "--tailnet-provider", options.tailnetProvider];
    }
    if (options.linkCodexConfig === true) {
      args = [...args, "--link-codex-config"];
    }
    if (options.linkClaudeConfig === true) {
      args = [...args, "--link-claude-config"];
    }
    if (options.fastMode === false) {
      args = [...args, "--no-fast-mode"];
    }
  }

  if (commandId === "tailnetSetProvider") {
    const provider = options.provider;
    if (typeof provider !== "string" || !TAILNET_PROVIDERS.has(provider)) {
      throw new Error(`Unsupported tailnet provider: ${provider}`);
    }
    args = [...command.args, provider];
  }

  if (command.needsCli) {
    // The bundled CLI package is a first-install seed only. Activation is
    // forward-only (a valid activated install is never re-pointed at the
    // seed), but self-update still skips it entirely: self-update only makes
    // sense against an existing install, so it must never seed one first.
    const cli = await resolveOpenbaseCoderCli({
      activateBundled: commandId !== "selfUpdate",
    });
    if (!cli.path) {
      throw new Error(cli.detail);
    }
    return {
      ...command,
      args,
      bin: cli.path,
      cliSource: cli.source,
    };
  }

  return { ...command, args };
}

async function runActivateCliCommand(event) {
  const commandId = "installCli";
  const commandText = INSTALLER_COMMANDS.installCli.label;
  sendInstallerEvent(event.sender, {
    commandId,
    commandText,
    type: "start",
  });
  try {
    const activation = await activateBundledCliPackage();
    if (!activation.activated) {
      throw new Error(activation.detail);
    }
    const version = await cliVersionDetail(activation.cliPath);
    sendInstallerEvent(event.sender, {
      commandId,
      stream: "stdout",
      text: `${activation.detail}\n${version}\n`,
      type: "output",
    });
    sendInstallerEvent(event.sender, {
      code: 0,
      commandId,
      signal: null,
      type: "exit",
    });
  } catch (error) {
    sendInstallerEvent(event.sender, {
      commandId,
      error: error.message,
      type: "error",
    });
    sendInstallerEvent(event.sender, {
      code: 1,
      commandId,
      signal: null,
      type: "exit",
    });
  }
  return { ok: true, commandText };
}

async function runInstallerCommand(event, commandId, options = {}) {
  if (installerProcess) {
    return { ok: false, error: "Another setup command is already running." };
  }

  if (commandId === "installCli") {
    return runActivateCliCommand(event);
  }

  let command;
  try {
    command = await commandWithOptions(commandId, options);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  if (!command) {
    return { ok: false, error: `Unknown setup command: ${commandId}` };
  }

  const { args, bin } = command;
  const commandText = [bin, ...args].join(" ");
  mainLogger.info("installer-command-start", {
    cliSource: command.cliSource || null,
    commandId,
    commandText,
  });
  return startInstallerProcess(event, commandId, command);
}

async function startInstallerProcess(event, commandId, command) {
  const { args, bin } = command;
  const commandText = [bin, ...args].join(" ");
  sendInstallerEvent(event.sender, {
    commandId,
    commandText,
    type: "start",
  });

  installerProcess = IS_WINDOWS
    ? spawn(bin, args, { env: installerEnv(), windowsHide: true })
    : spawn(LOGIN_SHELL, ["-lc", shellCommandFromArgs(bin, args)], {
        env: installerEnv(),
        windowsHide: true,
      });

  installerProcess.stdout.on("data", (chunk) => {
    sendInstallerEvent(event.sender, {
      commandId,
      stream: "stdout",
      text: chunk.toString(),
      type: "output",
    });
  });

  installerProcess.stderr.on("data", (chunk) => {
    sendInstallerEvent(event.sender, {
      commandId,
      stream: "stderr",
      text: chunk.toString(),
      type: "output",
    });
  });

  installerProcess.on("error", (error) => {
    mainLogger.error("installer-command-error", { commandId, error });
    sendInstallerEvent(event.sender, {
      commandId,
      error: error.message,
      type: "error",
    });
    installerProcess = null;
  });

  installerProcess.on("close", (code, signal) => {
    mainLogger.info("installer-command-exit", { code, commandId, signal });
    sendInstallerEvent(event.sender, {
      code,
      commandId,
      signal,
      type: "exit",
    });
    installerProcess = null;
  });

  return { ok: true, commandText };
}

// --- App auto-update (electron-updater, generic S3 feed) ---------------------
// The feed URL is baked into the packaged app-update.yml from the
// build.publish config in package.json; publish-s3.mjs uploads the zip and
// latest-mac.yml it points at. Dev (unpackaged) builds never check.

let appUpdateState = {
  error: null,
  status: "idle",
  version: null,
};

function setAppUpdateState(patch) {
  appUpdateState = { ...appUpdateState, ...patch };
  if (appUpdateState.status === "error") {
    mainLogger.error("app-update-state", appUpdateState);
  } else {
    mainLogger.info("app-update-state", appUpdateState);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("openbase:app-update:event", appUpdateState);
  }
}

function checkForAppUpdates() {
  autoUpdater.checkForUpdates().catch(() => {
    // The "error" event handler already recorded and logged the failure.
  });
}

function setupAppAutoUpdater() {
  if (!app.isPackaged) {
    mainLogger.info("app-update-disabled", { reason: "unpackaged development build" });
    return;
  }
  // Locally packaged dev installs must not "update" themselves from the
  // production feed (set by scripts or runtime-defaults.json).
  if (
    process.env.OPENBASE_DESKTOP_DISABLE_AUTOUPDATE === "1" ||
    RUNTIME_DEFAULTS.disableAutoUpdate === true ||
    APP_PACKAGE.openbaseDevBuild === true
  ) {
    mainLogger.info("app-update-disabled", { reason: "auto-update disabled for this build" });
    return;
  }

  autoUpdater.logger = mainLogger;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    setAppUpdateState({ error: null, status: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    setAppUpdateState({ error: null, status: "downloading", version: info?.version ?? null });
  });
  autoUpdater.on("update-not-available", () => {
    setAppUpdateState({ error: null, status: "up-to-date", version: null });
  });
  autoUpdater.on("update-downloaded", (info) => {
    setAppUpdateState({ error: null, status: "downloaded", version: info?.version ?? null });
  });
  autoUpdater.on("error", (error) => {
    setAppUpdateState({ error: error?.message ?? String(error), status: "error" });
  });

  checkForAppUpdates();
}

ipcMain.handle("openbase:app-update:status", async () => {
  return { appVersion: app.getVersion(), ok: true, state: appUpdateState };
});

// The renderer asks for the capability several times around startup (auth
// sync + focus + visibility handlers); each uncached ask costs seconds of CLI
// spawn. Coalesce concurrent asks, cache briefly (it only changes on
// re-login), and prefetch from whenReady so the answer usually beats the
// first ask.
const LOCAL_API_TOKEN_CACHE_MS = 5 * 60 * 1000;
let localApiTokenPromise = null;
let localApiTokenFetchedAt = 0;

function fetchLocalApiToken() {
  if (localApiTokenPromise && Date.now() - localApiTokenFetchedAt < LOCAL_API_TOKEN_CACHE_MS) {
    return localApiTokenPromise;
  }
  localApiTokenFetchedAt = Date.now();
  const startedAt = Date.now();
  localApiTokenPromise = (async () => {
    // Fast path: the capability lives at ~/.openbase/local-api-token (owner
    // 0600, >=40 chars — see the CLI's config/local_api_token.py). Only fall
    // back to the CLI when it's absent, so it can mint/repair one.
    try {
      const fileToken = (
        await fsp.readFile(path.join(OPENBASE_BASE_DIR, "local-api-token"), "utf8")
      ).trim();
      if (fileToken.length >= 40) {
        return fileToken;
      }
    } catch {
      // Missing file — the CLI below creates it.
    }
    const cli = await resolveOpenbaseCoderCli();
    const resolvedAt = Date.now();
    if (!cli.path) {
      throw new Error(cli.detail);
    }
    const result = await runArgv(cli.path, ["auth", "print-local-api-token"]);
    mainLogger.info("local-api-token-timing", {
      cliResolveMs: resolvedAt - startedAt,
      cliRunMs: Date.now() - resolvedAt,
      cliSource: cli.source,
    });
    const token = result.stdout.trim();
    if (result.code !== 0 || !token) {
      throw new Error(result.stderr.trim() || "Could not read the local API capability.");
    }
    return token;
  })();
  localApiTokenPromise.catch(() => {
    // Never cache a failure (CLI missing, logged out) — retry on next ask.
    localApiTokenPromise = null;
  });
  return localApiTokenPromise;
}

ipcMain.handle("openbase:auth:local-api-token", async (event) => {
  const frameUrl = event.senderFrame?.url || "";
  const trusted = rendererUrl
    ? (() => {
        try {
          return new URL(frameUrl).origin === new URL(rendererUrl).origin;
        } catch {
          return false;
        }
      })()
    : frameUrl.startsWith("file://");
  if (!trusted) {
    throw new Error("Local API capability access denied for this renderer.");
  }
  return fetchLocalApiToken();
});

ipcMain.handle("openbase:app-update:check", async () => {
  if (!app.isPackaged) {
    return { ok: false, error: "Auto-update is disabled in development builds." };
  }
  checkForAppUpdates();
  return { ok: true, state: appUpdateState };
});

// --- Desktop control server health ------------------------------------------
// If the localhost control server fails to start (port exhaustion, control
// file unwritable, …), phone/CLI-initiated features like remote screen share
// silently break, so the failure is pushed to the renderer for display.

let desktopControlState = {
  error: null,
  port: null,
  status: "starting",
};

function setDesktopControlState(patch) {
  desktopControlState = { ...desktopControlState, ...patch };
  if (desktopControlState.status === "error") {
    mainLogger.error("desktop-control-state", desktopControlState);
  } else {
    mainLogger.info("desktop-control-state", desktopControlState);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("openbase:desktop-control:event", desktopControlState);
  }
}

ipcMain.handle("openbase:desktop-control:status", async () => {
  return { ok: true, state: desktopControlState };
});

ipcMain.handle("openbase:app-update:quit-and-install", async () => {
  if (appUpdateState.status !== "downloaded") {
    return { ok: false, error: "No downloaded update is ready to install." };
  }
  mainLogger.info("app-update-quit-and-install", { version: appUpdateState.version });
  // Let the invoke reply reach the renderer before tearing the app down.
  setImmediate(() => autoUpdater.quitAndInstall());
  return { ok: true };
});

mainLogger.info("desktop-app starting", {
  backendBaseUrl,
  companionLogPath: COMPANION_LOG_PATH,
  logDir: LOG_DIR,
  mainLogPath: MAIN_LOG_PATH,
  rendererLogPath: RENDERER_LOG_PATH,
  rendererUrl: rendererUrl || null,
  version: app.getVersion(),
});

ipcMain.on("openbase:renderer-log", (event, entry = {}) => {
  rendererLogger.write(entry.level || "info", "renderer-ipc", {
    ...entry,
    frameUrl: event.senderFrame?.url || null,
  });
});

// LiveKit companion discovery/launch failures must reach the renderer (the
// screen-share UI shows `error` when `ok` is false) instead of rejecting the
// invoke with an opaque "Error invoking remote method" wrapper.
ipcMain.handle("openbase:livekit-companion:start-screen-share", async (_event, session) => {
  try {
    return await liveKitCompanion.startScreenShare(session);
  } catch (error) {
    mainLogger.error("livekit-companion-start-error", { message: error.message });
    return { ok: false, state: "error", error: error.message };
  }
});

ipcMain.handle("openbase:livekit-companion:stop-screen-share", async () => {
  try {
    return await liveKitCompanion.stopScreenShare();
  } catch (error) {
    mainLogger.error("livekit-companion-stop-error", { message: error.message });
    return { ok: false, state: "error", error: error.message };
  }
});

ipcMain.handle("openbase:livekit-companion:status", async () => {
  return liveKitCompanion.status();
});

ipcMain.handle("openbase:installer:check", async () => {
  return checkInstallerPrerequisites();
});

ipcMain.handle("openbase:installer:start", async (event, commandId, options) => {
  return runInstallerCommand(event, commandId, options);
});

ipcMain.handle("openbase:installer:cancel", async () => {
  if (!installerProcess) {
    return { ok: true, running: false };
  }
  installerProcess.kill("SIGTERM");
  return { ok: true, running: true };
});

ipcMain.handle("openbase:installer:open-tailscale-download", async () => {
  try {
    await shell.openExternal(TAILSCALE_MAC_APP_STORE_URL);
    return { ok: true };
  } catch (error) {
    mainLogger.error("open-tailscale-download-error", { message: error.message });
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("openbase:installer:open-tailscale-app", async () => {
  try {
    const result = await shellCapture("open -a Tailscale");
    if (result.code === 0) {
      return { ok: true, opened: "app" };
    }
    await shell.openExternal(TAILSCALE_MAC_APP_STORE_URL);
    return { ok: true, opened: "download" };
  } catch (error) {
    mainLogger.error("open-tailscale-app-error", { message: error.message });
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("openbase:shell:open-external", async (_event, targetUrl) => {
  if (typeof targetUrl !== "string") {
    return { ok: false, error: "URL must be a string." };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return { ok: false, error: "URL is invalid." };
  }

  if (!["https:", "http:"].includes(parsedUrl.protocol)) {
    return { ok: false, error: "Only http and https links can be opened." };
  }

  try {
    await shell.openExternal(parsedUrl.toString());
    return { ok: true };
  } catch (error) {
    mainLogger.error("shell-open-external-error", { message: error.message });
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("openbase:deep-link:ready", async () => {
  rendererDeepLinkReady = true;
  flushPendingDeepLinks();
  return { ok: true };
});

// Machine-onboarding progress (e.g. pairing acknowledged) lives with the
// installation in ~/.openbase, not in renderer localStorage: wiping or
// archiving the Openbase home must reset onboarding too.
const ONBOARDING_FLAGS_PATH = path.join(OPENBASE_BASE_DIR, "desktop-onboarding.json");

function readOnboardingFlags() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ONBOARDING_FLAGS_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

ipcMain.handle("openbase:onboarding:flags", async () => readOnboardingFlags());

ipcMain.handle("openbase:onboarding:set-flag", async (_event, key, value) => {
  if (typeof key !== "string" || !key) {
    return { ok: false, error: "invalid flag key" };
  }
  const flags = { ...readOnboardingFlags(), [key]: value };
  fs.mkdirSync(OPENBASE_BASE_DIR, { recursive: true });
  fs.writeFileSync(ONBOARDING_FLAGS_PATH, `${JSON.stringify(flags, null, 2)}\n`);
  return { ok: true };
});

ipcMain.handle("openbase:onboarding:tailscale-identity", async () => {
  try {
    return await readTailscaleSelfViaCli();
  } catch (error) {
    mainLogger.error("tailscale-identity-error", { message: error.message });
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("openbase:tailnet:provider", async () => {
  // The CLI owns both the materialized provider and the user-facing transport
  // catalog. Electron only renders that contract.
  try {
    return await readTailnetConfigViaCli();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// --- Netmesh VPN companion (macOS): register/approve/connect the embedded
// full-device netmesh VPN without the standalone Openbase Netmesh app. ---

ipcMain.handle("openbase:netmesh:status", async () => {
  try {
    const status = await netmeshCompanion.status();
    return { ...status, available: netmeshCompanion.available() };
  } catch (error) {
    return { ok: false, helper: "unavailable", available: false, error: error.message };
  }
});

ipcMain.handle("openbase:netmesh:register", async () => {
  try {
    const status = await netmeshCompanion.register();
    if (status.helper === "requiresApproval") {
      await netmeshCompanion.openApprovalSettings();
    }
    return status;
  } catch (error) {
    mainLogger.error("netmesh-register-error", { message: error.message });
    return { ok: false, helper: "unavailable", error: error.message };
  }
});

ipcMain.handle("openbase:netmesh:connect", async () => {
  try {
    const cli = await resolveOpenbaseCoderCli();
    if (!cli.path) {
      return { ok: false, helper: "unknown", error: cli.detail };
    }
    // Mint a single-use enroll key with the signed-in Openbase account; the
    // companion hands it to the root daemon over code-sign-verified XPC.
    const enrollment = await runArgv(cli.path, ["tailnet", "enroll", "--json"]);
    const stdout = enrollment.stdout || "";
    const jsonStart = stdout.indexOf("{");
    if (enrollment.code !== 0 || jsonStart === -1) {
      return {
        ok: false,
        helper: "unknown",
        error:
          (enrollment.stderr || stdout).trim() ||
          "Could not mint a netmesh key — sign in to Openbase first.",
      };
    }
    const { control_url: controlURL, auth_key: authKey } = JSON.parse(
      stdout.slice(jsonStart),
    );
    return await netmeshCompanion.connect({
      controlURL,
      authKey,
      hostname: os.hostname().replace(/\.local$/i, ""),
    });
  } catch (error) {
    mainLogger.error("netmesh-connect-error", { message: error.message });
    return { ok: false, helper: "unavailable", error: error.message };
  }
});

ipcMain.handle("openbase:netmesh:disconnect", async () => {
  try {
    return await netmeshCompanion.disconnect();
  } catch (error) {
    return { ok: false, helper: "unavailable", error: error.message };
  }
});

ipcMain.handle("openbase:onboarding:linux-tailscale-connect", async () => {
  if (linuxTailscaleOnboardingPromise) {
    return {
      error: "Tailscale onboarding is already running.",
      ok: false,
      supported: process.platform === "linux",
    };
  }
  linuxTailscaleOnboardingPromise = runLinuxTailscaleOnboarding({
    onConnected: async () => {
      const cli = await resolveOpenbaseCoderCli();
      if (!cli.path) {
        throw new Error(cli.detail);
      }
      await runLinuxTailscalePostConnect({
        cliPath: cli.path,
        runCommand: (bin, args) => runArgv(bin, args),
      });
    },
    openExternal: (url) => shell.openExternal(url),
  });
  try {
    return await linuxTailscaleOnboardingPromise;
  } catch (error) {
    mainLogger.error("linux-tailscale-onboarding-error", { message: error.message });
    return { error: error.message, ok: false, supported: process.platform === "linux" };
  } finally {
    linuxTailscaleOnboardingPromise = null;
  }
});

function attachRendererLogging(window) {
  rendererLogger.info("renderer-window-created", {
    backendBaseUrl,
    rendererUrl: rendererUrl || "file://dist/index.html",
  });

  // Electron ≥37 passes the console entry as a single details object
  // ({ level, message, lineNumber, sourceId, frame }; `level` is now a
  // string). The old positional signature (event, level, message, line,
  // sourceId) is removed in Electron 39, so read straight off the details.
  window.webContents.on("console-message", (details) => {
    rendererLogger.info("console-message", {
      level: details?.level,
      line: details?.lineNumber,
      message: details?.message,
      sourceId: details?.sourceId,
    });
  });

  window.webContents.on("did-finish-load", () => {
    rendererLogger.info("did-finish-load", { url: window.webContents.getURL() });
    if (process.platform === "linux") {
      try {
        markLinuxTailscaleOnboardingReady();
      } catch (error) {
        mainLogger.error("linux-tailscale-ready-marker-error", { message: error.message });
      }
    }
    flushPendingDeepLinks();
  });

  window.webContents.on("did-start-loading", () => {
    rendererDeepLinkReady = false;
  });

  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      rendererLogger.error("did-fail-load", {
        errorCode,
        errorDescription,
        isMainFrame,
        validatedURL,
      });
    },
  );

  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    rendererLogger.error("preload-error", { error, preloadPath });
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    rendererLogger.error("render-process-gone", details);
  });
}

function setupMediaPermissionHandler() {
  // Renderer microphone capture for voice calls. Only "media" requests get
  // explicit handling; everything else keeps Electron's default (allow) so
  // existing behavior is unchanged.
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (permission !== "media") {
        callback(true);
        return;
      }
      const wantsAudio =
        !details.mediaTypes || details.mediaTypes.includes("audio");
      if (wantsAudio && process.platform === "darwin") {
        systemPreferences
          .askForMediaAccess("microphone")
          .then((granted) => callback(granted))
          .catch((error) => {
            mainLogger.error("microphone-access-error", { message: error.message });
            callback(false);
          });
        return;
      }
      callback(true);
    },
  );
}

function createWindow() {
  const window = new BrowserWindow({
    title: "Openbase",
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    icon: appIconPath,
    backgroundColor: "#edf4ff",
    show: false,
    // The developer dashboard renders the console UI, which has no title-bar
    // inset of its own — a hidden title bar puts the traffic lights on top of
    // the console header, so give it a normal title bar instead.
    ...(process.platform === "darwin" && !developerDashboardOnly
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 18, y: 18 },
          vibrancy: "under-window",
          visualEffectState: "active",
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [
        `--openbase-backend-base-url=${backendBaseUrl}`,
        ...(developerDashboardOnly ? ["--openbase-developer-dashboard-only=1"] : []),
      ],
    },
  });
  mainWindow = window;

  // Avoid the blank-window flash: reveal once the renderer has painted.
  // ready-to-show is unreliable for hidden windows (observed never firing on
  // cold boots), so also show on did-finish-load and after a short fallback.
  let shown = false;
  const showWindow = () => {
    if (shown || window.isDestroyed()) return;
    shown = true;
    window.show();
  };
  window.once("ready-to-show", showWindow);
  window.webContents.once("did-finish-load", showWindow);
  setTimeout(showWindow, 2_000);

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
      rendererDeepLinkReady = false;
    }
  });

  attachRendererLogging(window);

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      if (["https:", "http:"].includes(parsedUrl.protocol)) {
        shell.openExternal(parsedUrl.toString());
      }
    } catch (error) {
      rendererLogger.error("window-open-url-error", { message: error.message, url });
    }
    return { action: "deny" };
  });

  if (rendererUrl) {
    window.loadURL(rendererUrl);
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

// Developer installs pair the dashboard with the Swift status menu-bar UI: the
// dashboard must never run without it (the reverse — menu bar alone — is
// fine). Public checkouts without the private sibling build just get the
// dashboard.
function ensureDevMenuBarApp() {
  if (!developerDashboardOnly || process.platform !== "darwin") return;
  const { execFile } = require("child_process");
  const productsDir = path.join(
    __dirname, "..", "..", "netmesh-macos", "DerivedData", "Build", "Products",
  );
  const candidate = ["Release", "Debug"]
    .map((configuration) => path.join(productsDir, configuration, "OpenbaseNetmesh.app"))
    .find((appPath) => fs.existsSync(appPath));
  if (!candidate) return;
  execFile("pgrep", ["-f", "OpenbaseNetmesh.app/Contents/MacOS/OpenbaseNetmesh$"], (notRunning) => {
    if (!notRunning) return;
    execFile("open", ["-g", candidate], (error) => {
      if (error) {
        mainLogger.error("dev-menu-bar-launch-failed", { message: error.message, candidate });
      } else {
        mainLogger.info("dev-menu-bar-launched", { candidate });
      }
    });
  });
}

function registerDeepLinkProtocol() {
  let registered = false;
  if (process.defaultApp) {
    registered = app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [
      path.resolve(process.argv[1] || "."),
    ]);
  } else {
    registered = app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
  }
  const logRegistration = registered ? mainLogger.info : mainLogger.error;
  logRegistration("deep-link-protocol-registration", {
    protocol: DEEP_LINK_PROTOCOL,
    registered,
  });
}

if (gotSingleInstanceLock) {
  const launchDeepLink = deepLinkArg(process.argv);

  app.whenReady().then(async () => {
  mainLogger.info("electron ready");
  if (await maybeMigrateLegacyAppBundle({ appPackage: APP_PACKAGE, logger: mainLogger })) {
    return;
  }
  registerDeepLinkProtocol();
  desktopControlServer = createDesktopControlServer({
    liveKitCompanion,
    logger: mainLogger,
  });
  desktopControlServer
    .start()
    .then((address) => {
      setDesktopControlState({ error: null, port: address?.port ?? null, status: "running" });
    })
    .catch((error) => {
      setDesktopControlState({
        error: `Desktop control server failed to start: ${error.message}`,
        status: "error",
      });
    });
  if (process.platform === "darwin") {
    app.dock.setIcon(appIconPath);
  }
  setupMediaPermissionHandler();
  ensureDevMenuBarApp();
  // Warm the auth capability while the renderer is still booting.
  fetchLocalApiToken().catch(() => {});
  createWindow();
  setupAppAutoUpdater();
  // Let the first window paint before possibly showing the installer
  // cleanup dialog on a fresh install.
  setTimeout(() => {
    void maybeOfferInstallerCleanup({
      appPackage: APP_PACKAGE,
      logger: mainLogger,
      parentWindow: mainWindow,
    });
  }, 1500);
  if (launchDeepLink) {
    handleDeepLink(launchDeepLink);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
  });
}

app.on("before-quit", () => {
  desktopControlServer?.stop();
  liveKitCompanion.cleanup?.();
  // Tears down only the control process — the netmesh VPN is a launchd daemon
  // and intentionally stays up across app quits.
  netmeshCompanion.cleanup?.();
});

app.on("window-all-closed", () => {
  mainLogger.info("window-all-closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});
