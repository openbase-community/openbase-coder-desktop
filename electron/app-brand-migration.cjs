const { app, dialog, shell } = require("electron");
const fsp = require("node:fs/promises");
const path = require("node:path");

const LEGACY_APP_NAME = "Openbase Coder.app";
const CURRENT_APP_NAME = "Openbase.app";

function enclosingAppBundle(executablePath) {
  const parts = path.resolve(executablePath).split(path.sep);
  const appIndex = parts.findIndex((part) => part.endsWith(".app"));
  if (appIndex < 0) return null;
  return path.sep + parts.slice(1, appIndex + 1).join(path.sep);
}

function appBundleMigrationPlan({
  executablePath,
  isPackaged,
  platform,
  targetExists,
}) {
  if (platform !== "darwin" || !isPackaged) return { action: "none" };
  const source = enclosingAppBundle(executablePath);
  if (!source || path.basename(source) !== LEGACY_APP_NAME) return { action: "none" };
  if (path.dirname(source) !== "/Applications") return { action: "none" };
  const target = path.join(path.dirname(source), CURRENT_APP_NAME);
  return targetExists
    ? { action: "conflict", source, target }
    : { action: "rename", source, target };
}

async function maybeMigrateLegacyAppBundle({ appPackage, logger }) {
  if (appPackage.openbaseDevBuild === true) return false;
  const executablePath = app.getPath("exe");
  const source = enclosingAppBundle(executablePath);
  const target = source ? path.join(path.dirname(source), CURRENT_APP_NAME) : null;
  let targetExists = false;
  if (target) {
    try {
      await fsp.access(target);
      targetExists = true;
    } catch {
      targetExists = false;
    }
  }
  const plan = appBundleMigrationPlan({
    executablePath,
    isPackaged: app.isPackaged,
    platform: process.platform,
    targetExists,
  });

  if (plan.action === "none") return false;

  if (plan.action === "conflict") {
    const { response } = await dialog.showMessageBox({
      buttons: ["Open Openbase", "Keep This Copy"],
      cancelId: 1,
      defaultId: 0,
      detail:
        "Both Openbase and the older Openbase Coder app are installed. Nothing will be deleted. Open the renamed app, then remove the older copy when you are ready.",
      message: "Openbase is already installed",
      type: "info",
    });
    logger.info("app-brand-migration-conflict", { response, source: plan.source, target: plan.target });
    if (response === 0) {
      await shell.openPath(plan.target);
      app.quit();
      return true;
    }
    return false;
  }

  try {
    await fsp.rename(plan.source, plan.target);
    const newExecutable = path.join(plan.target, "Contents", "MacOS", "Openbase");
    logger.info("app-brand-migration-renamed", { source: plan.source, target: plan.target });
    app.relaunch({ execPath: newExecutable });
    app.quit();
    return true;
  } catch (error) {
    logger.error("app-brand-migration-error", {
      message: error.message,
      source: plan.source,
      target: plan.target,
    });
    await dialog.showMessageBox({
      buttons: ["Continue"],
      detail:
        "Openbase could not rename the older app bundle automatically. The app will continue to work; you can rename it to Openbase in Applications later.",
      message: "App rename needs attention",
      type: "warning",
    });
    return false;
  }
}

module.exports = {
  CURRENT_APP_NAME,
  LEGACY_APP_NAME,
  appBundleMigrationPlan,
  enclosingAppBundle,
  maybeMigrateLegacyAppBundle,
};
