// First-launch install hygiene. /Applications is the only supported install
// location. When the packaged app runs from anywhere else, offer to move it
// there (LetsMove-style, via app.moveToApplicationsFolder). When it runs from
// /Applications for the first time and the install DMG is still mounted or
// sitting in Downloads/Desktop, offer to eject it and move it to the Trash —
// enumerating exactly what will be touched. Each flow's answer is remembered
// in userData so its prompt shows at most once per installation.
const { app, dialog, shell } = require("electron");
const { execFile, spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

// Match current Openbase installers plus legacy Openbase Coder downloads so
// an upgrade can still clean up an older DMG.
const INSTALLER_DMG_PATTERN = /^Openbase(?:[- ]Coder)?.*\.dmg$/i;
const INSTALLER_VOLUME_PREFIXES = ["Openbase ", "Openbase Coder"];

function flagFilePath() {
  return path.join(app.getPath("userData"), "installer-cleanup.json");
}

// One JSON file holds a key per one-time flow ("cleanup", "moveOffer") so the
// flows are remembered independently: declining the move offer must not
// suppress the cleanup prompt after the user later moves the app themselves.
async function readState() {
  try {
    const parsed = JSON.parse(await fsp.readFile(flagFilePath(), "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    // Legacy schema: a top-level { outcome } meant the cleanup flow ran.
    if (typeof parsed.outcome === "string" && !parsed.cleanup) {
      return { ...parsed, cleanup: { outcome: parsed.outcome } };
    }
    return parsed;
  } catch {
    return {};
  }
}

async function writeState(key, outcome) {
  const state = await readState();
  state[key] = { outcome, promptedAt: new Date().toISOString(), version: app.getVersion() };
  await fsp.mkdir(path.dirname(flagFilePath()), { recursive: true });
  await fsp.writeFile(flagFilePath(), `${JSON.stringify(state, null, 2)}\n`);
}

// A dialog parented to a window the user already closed throws; fall back to
// an unparented dialog instead of aborting the flow (and re-prompting later).
function dialogParent(parentWindow) {
  return parentWindow && !parentWindow.isDestroyed() ? parentWindow : undefined;
}

function plistToJson(plistXml) {
  return new Promise((resolve, reject) => {
    const child = spawn("plutil", ["-convert", "json", "-o", "-", "-"]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`plutil exited with ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(plistXml);
  });
}

async function findMountedInstallerImages() {
  const { stdout } = await execFileAsync("hdiutil", ["info", "-plist"], {
    maxBuffer: 8 * 1024 * 1024,
  });
  const info = await plistToJson(stdout);
  const images = Array.isArray(info?.images) ? info.images : [];
  const matches = [];
  for (const image of images) {
    const imagePath = typeof image["image-path"] === "string" ? image["image-path"] : "";
    const mountPoints = (Array.isArray(image["system-entities"]) ? image["system-entities"] : [])
      .map((entity) => entity["mount-point"])
      .filter((mountPoint) => typeof mountPoint === "string" && mountPoint.length > 0);
    const imageMatches = INSTALLER_DMG_PATTERN.test(path.basename(imagePath));
    const volumeMatches = mountPoints.some((mountPoint) =>
      INSTALLER_VOLUME_PREFIXES.some((prefix) =>
        path.basename(mountPoint).startsWith(prefix),
      ),
    );
    if ((imageMatches || volumeMatches) && mountPoints.length > 0) {
      matches.push({ imagePath, mountPoints });
    }
  }
  return matches;
}

async function findDownloadedInstallerDmgs() {
  const home = os.homedir();
  const results = [];
  for (const dir of [path.join(home, "Downloads"), path.join(home, "Desktop")]) {
    let entries = [];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (INSTALLER_DMG_PATTERN.test(entry)) {
        results.push(path.join(dir, entry));
      }
    }
  }
  return results;
}

function collectTrashTargets(dmgPaths, mountedImages) {
  const trashTargets = new Set(dmgPaths);
  for (const image of mountedImages) {
    if (image.imagePath && INSTALLER_DMG_PATTERN.test(path.basename(image.imagePath))) {
      trashTargets.add(image.imagePath);
    }
  }
  return [...trashTargets];
}

// The exact eject/trash actions, one line each, shown verbatim in the consent
// dialog: the user must see everything the cleanup will touch before agreeing.
function plannedActionLines(mountedImages, trashTargets) {
  const lines = [];
  for (const image of mountedImages) {
    for (const mountPoint of image.mountPoints) {
      lines.push(`Eject "${path.basename(mountPoint)}"`);
    }
  }
  for (const dmgPath of trashTargets) {
    lines.push(`Move "${path.basename(dmgPath)}" to the Trash`);
  }
  return lines;
}

async function performCleanup({ logger, mountedImages, trashTargets }) {
  let ejected = 0;
  let trashed = 0;
  const failures = [];

  for (const image of mountedImages) {
    for (const mountPoint of image.mountPoints) {
      try {
        await execFileAsync("hdiutil", ["detach", mountPoint]);
        ejected += 1;
      } catch (error) {
        failures.push(`Could not eject ${mountPoint}`);
        logger.error("installer-cleanup-detach-error", { message: error.message, mountPoint });
      }
    }
  }

  for (const dmgPath of trashTargets) {
    try {
      await fsp.access(dmgPath);
      await shell.trashItem(dmgPath);
      trashed += 1;
    } catch (error) {
      failures.push(`Could not move ${path.basename(dmgPath)} to the Trash`);
      logger.error("installer-cleanup-trash-error", { dmgPath, message: error.message });
    }
  }

  return { ejected, failures, trashed };
}

function cleanupSummary({ ejected, failures, trashed }) {
  const lines = [];
  if (ejected > 0) {
    lines.push(ejected === 1 ? "Ejected the installer disk." : `Ejected ${ejected} installer disks.`);
  }
  if (trashed > 0) {
    lines.push(
      trashed === 1
        ? "Moved the installer to the Trash."
        : `Moved ${trashed} installers to the Trash.`,
    );
  }
  lines.push(...failures);
  return lines.join("\n");
}

// /Applications is the only supported install location; offer to move the
// app there and relaunch. moveToApplicationsFolder quits this instance on
// success, so nothing meaningful runs after it.
async function maybeOfferMoveToApplications({ logger, parentWindow }) {
  const state = await readState();
  if (state.moveOffer) {
    return;
  }

  const { response } = await dialog.showMessageBox(dialogParent(parentWindow), {
    buttons: ["Move to Applications", "Not Now"],
    cancelId: 1,
    defaultId: 0,
    detail:
      "Openbase needs to run from the Applications folder to stay up to date. It will move itself there and relaunch.",
    message: "Move Openbase to the Applications folder?",
    type: "info",
  });
  await writeState("moveOffer", response === 0 ? "move" : "not-now");
  logger.info("installer-move-offer-response", {
    response: response === 0 ? "move" : "not-now",
  });
  if (response !== 0) {
    return;
  }
  const moved = app.moveToApplicationsFolder({
    conflictHandler: () => true,
  });
  if (!moved) {
    logger.error("installer-move-failed", { exe: app.getPath("exe") });
  }
}

/**
 * First packaged launch: from outside /Applications, offer to move the app
 * there; from /Applications, offer to clean up the install DMG. Resolves once
 * the flow finishes; never throws.
 */
async function maybeOfferInstallerCleanup({ appPackage, logger, parentWindow }) {
  try {
    if (process.platform !== "darwin" || !app.isPackaged) {
      return;
    }
    if (appPackage.openbaseDevBuild === true) {
      return;
    }
    // Escape hatch for automated installs (E2E, release verification) where
    // an unexpected native modal would stall the run.
    if (process.env.OPENBASE_DESKTOP_DISABLE_INSTALLER_CLEANUP === "1") {
      return;
    }
    if (!app.getPath("exe").startsWith("/Applications/")) {
      // Running from the DMG, a translocated copy, ~/Applications, or another
      // unsupported location: the fix is to move the install, and the DMG
      // cleanup prompt stays reserved for the first /Applications launch.
      await maybeOfferMoveToApplications({ logger, parentWindow });
      return;
    }
    const state = await readState();
    if (state.cleanup) {
      return;
    }

    const [mountedImages, dmgPaths] = await Promise.all([
      findMountedInstallerImages(),
      findDownloadedInstallerDmgs(),
    ]);
    const trashTargets = collectTrashTargets(dmgPaths, mountedImages);
    if (mountedImages.length === 0 && trashTargets.length === 0) {
      // Not a DMG install (or the installer is already gone). Remember that
      // the first launch was inspected so we never rescan or prompt again.
      await writeState("cleanup", "nothing-to-clean");
      return;
    }

    const { response } = await dialog.showMessageBox(dialogParent(parentWindow), {
      buttons: ["Clean Up", "Not Now"],
      cancelId: 1,
      defaultId: 0,
      detail: `Would you like to clean up the installer? This will:\n\n${plannedActionLines(
        mountedImages,
        trashTargets,
      )
        .map((line) => `• ${line}`)
        .join("\n")}`,
      message: "Openbase has been installed successfully.",
      type: "info",
    });

    // Persist before acting so a mid-cleanup crash can never re-prompt.
    await writeState("cleanup", response === 0 ? "clean-up" : "not-now");
    logger.info("installer-cleanup-response", {
      mountedCount: mountedImages.length,
      response: response === 0 ? "clean-up" : "not-now",
      trashCount: trashTargets.length,
    });
    if (response !== 0) {
      return;
    }

    const result = await performCleanup({ logger, mountedImages, trashTargets });
    logger.info("installer-cleanup-result", result);
    if (result.ejected > 0 || result.trashed > 0 || result.failures.length > 0) {
      await dialog.showMessageBox(dialogParent(parentWindow), {
        buttons: ["OK"],
        detail: cleanupSummary(result),
        message: "Installer cleaned up",
        type: result.failures.length > 0 ? "warning" : "info",
      });
    }
  } catch (error) {
    logger.error("installer-cleanup-error", { message: error.message });
  }
}

module.exports = { maybeOfferInstallerCleanup };
