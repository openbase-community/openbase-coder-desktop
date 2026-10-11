import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Public desktop releases may download the private Netmesh apps as signed
// prebuilts. Keep the minimum build here so develop cannot silently package an
// older artifact that predates behavior the desktop runtime relies on.
export const MINIMUM_NETMESH_BUILD = 20;

const STAGING_WEB_BACKEND_URL = "https://app-staging.openbase.cloud";
const WEB_BACKEND_ENV_KEY = "OPENBASE_CODER_CLI_WEB_BACKEND_URL";

// The cloud a developer install targets. The process env wins; otherwise read
// the installed ~/.openbase/.env, the same file the CLI and its services use,
// so a staging install stages staging prebuilts without exporting anything.
export function configuredWebBackendUrl(
  env = process.env,
  envFilePath = path.join(os.homedir(), ".openbase", ".env"),
) {
  if (env[WEB_BACKEND_ENV_KEY]) return env[WEB_BACKEND_ENV_KEY];
  let text;
  try {
    text = readFileSync(envFilePath, "utf8");
  } catch {
    return undefined;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match?.[1] === WEB_BACKEND_ENV_KEY) {
      return match[2].trim().replace(/^(['"])(.*)\1$/, "$2") || undefined;
    }
  }
  return undefined;
}

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
