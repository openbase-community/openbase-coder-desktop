function isDeveloperDashboardOnly({ appPackaged, installation }) {
  // Every unpackaged Electron process is a developer visual surface. A
  // development installation remains dashboard-only even if a packaged app is
  // opened on the same machine. Production onboarding is exercised only from
  // a packaged standalone build.
  return !appPackaged || installation?.standalone === false;
}

module.exports = { isDeveloperDashboardOnly };
