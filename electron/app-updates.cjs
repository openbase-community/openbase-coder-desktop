// Keep startup, renderer requests and install-on-quit behind the same policy.
function createAppUpdateController({ autoUpdater, getPolicy, getState, setState, logger, schedule = setImmediate }) {
  let configured = false;
  let installScheduled = false;
  let installing = false;

  function enabled() {
    const policy = getPolicy();
    return policy.appPackaged && !policy.appDevBuild && !policy.developerDashboardOnly
      && policy.installation?.standalone !== false
      && policy.disabledByEnv !== "1" && policy.disabledByDefaults !== true;
  }

  function prepareForQuit() {
    const allowed = enabled();
    autoUpdater.autoDownload = allowed;
    // MacUpdater hands the archive to Squirrel as soon as it downloads when
    // this is true. Clearing the flag at quit cannot revoke that handoff.
    // Keep native staging behind our guarded explicit/ordinary quit path.
    autoUpdater.autoInstallOnAppQuit = false;
    return allowed;
  }

  // electron-updater defaults to automatic installation, even before setup.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  function check() {
    if (!prepareForQuit()) {
      return { ok: false, error: "Release updates are disabled for this installation." };
    }
    if (!configured) {
      configured = true;
      autoUpdater.logger = logger;
      const updateState = (patch) => {
        if (prepareForQuit()) setState(patch);
      };
      autoUpdater.on("checking-for-update", () => updateState({ error: null, status: "checking" }));
      autoUpdater.on("update-available", (info) => updateState({ error: null, status: "downloading", version: info?.version ?? null }));
      autoUpdater.on("update-not-available", () => updateState({ error: null, status: "up-to-date", version: null }));
      autoUpdater.on("update-downloaded", (info) => updateState({ error: null, status: "downloaded", version: info?.version ?? null }));
      autoUpdater.on("error", (error) => {
        installing = false;
        updateState({ error: error?.message ?? String(error), status: "error" });
      });
    }
    autoUpdater.checkForUpdates().catch(() => {
      // The error event records and logs the failure.
    });
    return { ok: true, state: getState() };
  }

  function install() {
    if (!prepareForQuit()) {
      return { ok: false, error: "Release updates are disabled for this installation." };
    }
    if (getState().status !== "downloaded") {
      return { ok: false, error: "No downloaded update is ready to install." };
    }
    if (installScheduled || installing) return { ok: true };
    logger.info("app-update-quit-and-install", { version: getState().version });
    installScheduled = true;
    schedule(() => {
      installScheduled = false;
      if (prepareForQuit()) {
        installing = true;
        autoUpdater.quitAndInstall();
      }
    });
    return { ok: true };
  }

  function beforeQuit(event) {
    if (prepareForQuit() && getState().status === "downloaded" && !installing) {
      event.preventDefault();
      install();
    }
  }

  return { check, install, prepareForQuit, beforeQuit };
}

module.exports = { createAppUpdateController };
