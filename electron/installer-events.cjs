const INSTALLER_EVENT_CHANNEL = "openbase:installer:event";

function sendInstallerEvent(sender, payload) {
  // Installer commands can outlive their onboarding window. Electron throws
  // if an asynchronous process callback sends through destroyed webContents.
  if (sender.isDestroyed()) {
    return false;
  }
  sender.send(INSTALLER_EVENT_CHANNEL, payload);
  return true;
}

module.exports = { INSTALLER_EVENT_CHANNEL, sendInstallerEvent };
