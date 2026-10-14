// The helper starts the VPN/services after a complete quit. Hold the dashboard
// on a loading page until the API can answer, instead of caching failed initial
// requests for the rest of this desktop session.
async function waitForBackendAfterQuit({
  backendBaseUrl,
  isCancelled = () => false,
  fetchImpl = fetch,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 90,
}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (isCancelled()) return false;
    try {
      const response = await fetchImpl(new URL("/api/health/", backendBaseUrl), {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return true;
    } catch {
      // Connection refusal is expected while the helper restores services.
    }
    await delay(1_000);
  }
  return false;
}

module.exports = { waitForBackendAfterQuit };
