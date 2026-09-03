import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const errors = [];

function env(name) {
  return process.env[name]?.trim();
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function requireCommand(command, args, description) {
  try {
    run(command, args);
  } catch {
    errors.push(`Missing ${description}.`);
  }
}

function hasAll(names) {
  return names.every((name) => Boolean(env(name)));
}

function hasAny(names) {
  return names.some((name) => Boolean(env(name)));
}

if (process.platform !== "darwin") {
  errors.push("macOS release builds must run on macOS.");
}

requireCommand("xcrun", ["--find", "notarytool"], "xcrun notarytool");
requireCommand("xcrun", ["--find", "stapler"], "xcrun stapler");
requireCommand("xcrun", ["--find", "xcodebuild"], "xcodebuild");

if (!existsSync("/usr/bin/tiffutil")) {
  errors.push("Missing /usr/bin/tiffutil (needed for the Retina DMG background).");
}

// The DMG layout step scripts Finder; exercising it here surfaces the macOS
// Automation permission prompt during preflight instead of mid-build.
try {
  run("osascript", ["-e", 'tell application "Finder" to get name']);
} catch {
  errors.push(
    "Cannot script Finder (macOS Automation permission). Approve the prompt or enable it in System Settings > Privacy & Security > Automation, then rerun.",
  );
}

if (!env("CSC_LINK")) {
  let identities = "";
  try {
    identities = run("security", ["find-identity", "-v", "-p", "codesigning"]);
  } catch {
    errors.push("Unable to inspect local code signing identities.");
  }

  if (!identities.includes("Developer ID Application")) {
    errors.push("No local Developer ID Application signing identity was found.");
  }
}

const apiKeyVars = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];
const appleIdVars = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];
const keychainProfileVars = ["APPLE_KEYCHAIN_PROFILE"];

const hasApiKeyCredential = hasAll(apiKeyVars);
const hasAppleIdCredential = hasAll(appleIdVars);
const hasKeychainCredential = hasAll(keychainProfileVars);

if (hasAny(apiKeyVars) && !hasApiKeyCredential) {
  errors.push("APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER must be set together.");
}

if (hasAny(appleIdVars) && !hasAppleIdCredential) {
  errors.push("APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID must be set together.");
}

if (!hasApiKeyCredential && !hasAppleIdCredential && !hasKeychainCredential) {
  errors.push(
    "Set one notarization credential set: APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER, APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID, or APPLE_KEYCHAIN_PROFILE.",
  );
}

if (hasApiKeyCredential && !existsSync(env("APPLE_API_KEY"))) {
  errors.push("APPLE_API_KEY must point to an existing App Store Connect API key .p8 file.");
}

if (hasKeychainCredential) {
  const args = ["notarytool", "history", "--keychain-profile", env("APPLE_KEYCHAIN_PROFILE")];
  if (env("APPLE_KEYCHAIN")) {
    args.push("--keychain", env("APPLE_KEYCHAIN"));
  }

  try {
    run("xcrun", args);
  } catch {
    errors.push("APPLE_KEYCHAIN_PROFILE does not resolve to stored notarytool credentials.");
  }
}

if (errors.length > 0) {
  console.error("Mac release preflight failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Mac release preflight passed.");
