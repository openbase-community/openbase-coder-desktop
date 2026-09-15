async function reconcileNetmeshHelperOnLaunch({
  enabled,
  readTailnetConfig,
  register,
  repairAfterAppUpdate,
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

      if (repairAfterAppUpdate) {
        try {
          const repaired = await repairAfterAppUpdate();
          if (repaired?.ok === false) {
            throw new Error(repaired.error || "Netmesh helper repair failed.");
          }
          logger.info("netmesh-helper-launch-repaired", {
            helper: repaired?.helper ?? "unknown",
            helperReplaced: repaired?.helperReplaced === true,
          });
          return repaired;
        } catch (repairError) {
          logger.error("netmesh-helper-launch-reconciliation-error", {
            message: repairError.message,
          });
          return null;
        }
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
