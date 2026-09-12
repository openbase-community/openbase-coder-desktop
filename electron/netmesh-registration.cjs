// Resume a pending helper handoff in a new companion request. Never present
// HTTP 202 as completion or retry an approval denial.
async function completeHelperReplacement(
  request,
  register,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const status = await request();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (status.ok === false || status.helperReplacementPending !== true) return status;
    if (status.helper !== "notRegistered") {
      throw new Error(`Helper replacement cannot continue in state ${status.helper}`);
    }
    await wait(200);
    const registration = await register();
    if (registration.ok === false) return registration;
    if (registration.helper === "enabled") {
      const verified = await request();
      if (verified.helperReplacementPending === true) {
        throw new Error("Helper replacement verification did not complete.");
      }
      return verified.ok === false ? verified : { ...verified, helperReplaced: true };
    }
    if (registration.helper !== "notRegistered") {
      throw new Error(`Helper replacement cannot continue in state ${registration.helper}`);
    }
  }
  throw new Error("Helper replacement registration did not complete.");
}

module.exports = { completeHelperReplacement };
