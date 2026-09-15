async function reconcileNetmeshHelperOnLaunch({
  enabled,
  readTailnetConfig,
  register,
  logger,
  maxAttempts = 3,
  retryDelayMs = 1000,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  if (!enabled) return null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const config = await readTailnetConfig();
      if (!config?.ok || config.provider !== "netmesh") return null;

      const status = await register();
      if (status?.ok === false) {
        throw new Error(status.error || "Netmesh helper reconciliation failed.");
      }
      logger.info("netmesh-helper-launch-reconciled", {
        helper: status?.helper ?? "unknown",
        helperReplaced: status?.helperReplaced === true,
      });
      return status;
    } catch (error) {
      if (attempt < maxAttempts) {
        logger.info("netmesh-helper-launch-reconciliation-retrying", {
          attempt,
          maxAttempts,
          message: error.message,
        });
        await wait(retryDelayMs * attempt);
        continue;
      }

      // The desktop UI and local backend remain usable when the VPN helper is
      // unavailable. Record the actionable failure without crashing app launch;
      // onboarding can still surface approval or retry registration explicitly.
      logger.error("netmesh-helper-launch-reconciliation-error", {
        message: error.message,
      });
      return null;
    }
  }

  return null;
}

module.exports = { reconcileNetmeshHelperOnLaunch };
