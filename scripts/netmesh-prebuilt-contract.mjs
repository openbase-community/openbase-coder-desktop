// Public desktop releases may download the private Netmesh apps as signed
// prebuilts. Keep the minimum build here so develop cannot silently package an
// older artifact that predates behavior the desktop runtime relies on.
export const MINIMUM_NETMESH_BUILD = 17;

const STAGING_WEB_BACKEND_URL = "https://app-staging.openbase.cloud";

export function resolveNetmeshPrebuiltPrefix(
  packageVersion,
  configuredPrefix,
  webBackendUrl,
) {
  if (configuredPrefix) return configuredPrefix;
  if (String(packageVersion).includes("-staging.")) return "mac-staging";
  if (String(webBackendUrl ?? "").replace(/\/+$/, "") === STAGING_WEB_BACKEND_URL) {
    return "mac-staging";
  }
  return "mac";
}

export function assertSupportedNetmeshBuild(rawBuild, label) {
  const value = String(rawBuild).trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} has an invalid CFBundleVersion: ${JSON.stringify(value)}`);
  }

  const build = Number(value);
  if (build < MINIMUM_NETMESH_BUILD) {
    throw new Error(
      `${label} build ${build} is too old; build ${MINIMUM_NETMESH_BUILD} or newer is required`,
    );
  }
  return build;
}
