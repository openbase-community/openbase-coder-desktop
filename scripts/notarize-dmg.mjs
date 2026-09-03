import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(repoRoot, "release");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const currentDmgPattern = new RegExp(
  `^Openbase-${packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-.+\\.dmg$`,
);

function env(name) {
  return process.env[name]?.trim();
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function signingIdentity() {
  return env("CSC_NAME") ?? "Developer ID Application";
}

function notarizationArgs() {
  if (env("APPLE_KEYCHAIN_PROFILE")) {
    const args = ["--keychain-profile", env("APPLE_KEYCHAIN_PROFILE")];
    if (env("APPLE_KEYCHAIN")) {
      args.push("--keychain", env("APPLE_KEYCHAIN"));
    }
    return args;
  }

  if (env("APPLE_API_KEY") && env("APPLE_API_KEY_ID") && env("APPLE_API_ISSUER")) {
    return [
      "--key",
      env("APPLE_API_KEY"),
      "--key-id",
      env("APPLE_API_KEY_ID"),
      "--issuer",
      env("APPLE_API_ISSUER"),
    ];
  }

  if (env("APPLE_ID") && env("APPLE_APP_SPECIFIC_PASSWORD") && env("APPLE_TEAM_ID")) {
    return [
      "--apple-id",
      env("APPLE_ID"),
      "--password",
      env("APPLE_APP_SPECIFIC_PASSWORD"),
      "--team-id",
      env("APPLE_TEAM_ID"),
    ];
  }

  throw new Error("No notarization credentials found for DMG notarization.");
}

const dmgNames = readdirSync(releaseDir).filter((fileName) => currentDmgPattern.test(fileName)).sort();

if (dmgNames.length === 0) {
  throw new Error(`No current DMG artifact found in ${releaseDir}`);
}

for (const dmgName of dmgNames) {
  const dmgPath = path.join(releaseDir, dmgName);
  run("codesign", ["--force", "--sign", signingIdentity(), "--timestamp", dmgPath]);
  run("xcrun", ["notarytool", "submit", dmgPath, "--wait", ...notarizationArgs()]);
  run("xcrun", ["stapler", "staple", dmgPath]);
  run("xcrun", ["stapler", "validate", dmgPath]);
  console.log(`Notarized and stapled ${dmgName}`);
}
