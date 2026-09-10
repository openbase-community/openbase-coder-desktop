function isDeveloperDashboardOnly({ appPackaged, envValue, installation }) {
  // Every unpackaged Electron process is a developer visual surface. A
  // development installation remains dashboard-only even if a packaged app is
  // opened on the same machine, and the env/argv override opts a packaged app
  // in explicitly (the /Applications launcher stub starts Electron through
  // `open -a`, which cannot pass environment variables — main.cjs also maps
  // the --openbase-dev-dashboard argv form onto envValue). Production
  // onboarding is exercised only from a packaged standalone build.
  return !appPackaged || installation?.standalone === false || envValue === "1";
}

module.exports = { isDeveloperDashboardOnly };
