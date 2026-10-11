// Stages OpenbaseScreenShareCompanion.app (the ScreenCaptureKit capture and
// remote-control helper that ships inside Openbase.app's Resources) into
// companion-build/ for electron-builder's extraResources and for developer
// installs, where the Electron app launches it from companion-build/.
//
// Builds from the in-repo Swift source with Xcode when sources are newer than
// the staged app; keeps a fresh staged app otherwise; and without Xcode
// downloads the signed prebuilt published by the release pipeline.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { signAppBundle } from "./macos-code-signing.mjs";
import { downloadNativeBundle } from "./native-bundle-staging.mjs";
import { configuredWebBackendUrl, resolveNetmeshPrebuiltPrefix } from "./netmesh-prebuilt-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const companionRoot = path.join(repoRoot, "companion", "livekit-swift-example");
const derivedDataPath = path.join(repoRoot, "companion-build", "derivedData");
const stagedRoot = path.join(repoRoot, "companion-build");
const builtAppPath = path.join(
  derivedDataPath,
  "Build",
  "Products",
  "Release",
  "OpenbaseScreenShareCompanion.app",
);
const stagedAppPath = path.join(stagedRoot, "OpenbaseScreenShareCompanion.app");
export const SCREEN_SHARE_COMPANION_ZIP_NAME = "OpenbaseScreenShareCompanion-latest-arm64.zip";

function newestSourceMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestSourceMtime(entryPath));
    } else {
      newest = Math.max(newest, statSync(entryPath).mtimeMs);
    }
  }
  return newest;
}

function stagedAppIsFresh() {
  const executable = path.join(stagedAppPath, "Contents", "MacOS", "OpenbaseScreenShareCompanion");
  if (!existsSync(executable)) return false;
  const builtAt = statSync(executable).mtimeMs;
  const sources = [
    path.join(companionRoot, "Multiplatform"),
    path.join(companionRoot, "LiveKitExample.xcodeproj", "project.pbxproj"),
  ];
  return sources.every((source) =>
    !existsSync(source) || (statSync(source).isDirectory() ? newestSourceMtime(source) : statSync(source).mtimeMs) <= builtAt,
  );
}

function hasXcode() {
  try {
    execFileSync("xcodebuild", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function prebuiltCompanionUrl() {
  const packageVersion = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
  const releasePrefix = resolveNetmeshPrebuiltPrefix(
    packageVersion,
    process.env.OPENBASE_CODER_RELEASE_PREFIX,
    configuredWebBackendUrl(),
  );
  return (
    process.env.OPENBASE_SCREEN_SHARE_COMPANION_URL ??
    `https://openbase-coder-desktop-releases-632795836081-us-east-1.s3.amazonaws.com/${releasePrefix}/${SCREEN_SHARE_COMPANION_ZIP_NAME}`
  );
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

function replaceSymlink(linkPath, target) {
  if (existsSync(linkPath) || lstatSync(linkPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    unlinkSync(linkPath);
  }
  symlinkSync(target, linkPath);
}

function normalizeVersionedFrameworkSymlinks(appPath) {
  const frameworksPath = path.join(appPath, "Contents", "Frameworks");
  if (!existsSync(frameworksPath)) return;

  for (const entry of readdirSync(frameworksPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith(".framework")) continue;

    const frameworkPath = path.join(frameworksPath, entry.name);
    const versionsPath = path.join(frameworkPath, "Versions");
    const versionAPath = path.join(versionsPath, "A");
    if (!existsSync(versionAPath)) continue;

    const frameworkName = entry.name.slice(0, -".framework".length);
    replaceSymlink(path.join(versionsPath, "Current"), "A");

    if (existsSync(path.join(versionAPath, frameworkName))) {
      replaceSymlink(path.join(frameworkPath, frameworkName), path.join("Versions", "Current", frameworkName));
    }

    if (existsSync(path.join(versionAPath, "Resources"))) {
      replaceSymlink(path.join(frameworkPath, "Resources"), path.join("Versions", "Current", "Resources"));
    }
  }
}

// Setup and dev-launch re-run this on every launch: skip the multi-minute
// Xcode build when nothing under the Swift source changed. The release
// build (dist:mac) always rebuilds through `--force`.
if (!process.argv.includes("--force") && stagedAppIsFresh()) {
  console.log(`[stage-mac-companion] keeping fresh companion at ${path.relative(repoRoot, stagedAppPath)}`);
  process.exit(0);
}

if (!hasXcode()) {
  // Public checkouts without Xcode get the signed prebuilt, like the netmesh apps.
  mkdirSync(stagedRoot, { recursive: true });
  downloadNativeBundle(stagedAppPath, prebuiltCompanionUrl(), SCREEN_SHARE_COMPANION_ZIP_NAME, (incoming) => {
    if (!existsSync(path.join(incoming, "Contents", "MacOS", "OpenbaseScreenShareCompanion"))) {
      throw new Error("downloaded screen-share companion has no executable");
    }
  });
  console.log(`[stage-mac-companion] staged prebuilt ${path.relative(repoRoot, stagedAppPath)}`);
  process.exit(0);
}

// A full rebuild: clear only this companion's outputs, never the sibling
// netmesh apps that share companion-build/.
rmSync(stagedAppPath, { force: true, recursive: true });
rmSync(derivedDataPath, { force: true, recursive: true });
mkdirSync(stagedRoot, { recursive: true });

run("xcodebuild", [
  "-project",
  path.join(companionRoot, "LiveKitExample.xcodeproj"),
  "-scheme",
  "SwiftSDK.1",
  "-destination",
  "platform=macOS",
  "-configuration",
  "Release",
  "-derivedDataPath",
  derivedDataPath,
  "CODE_SIGNING_ALLOWED=NO",
  "CODE_SIGNING_REQUIRED=NO",
  "CODE_SIGN_IDENTITY=",
  "build",
]);

if (!existsSync(builtAppPath)) {
  throw new Error(`Expected companion app was not built at ${builtAppPath}`);
}

cpSync(builtAppPath, stagedAppPath, { recursive: true });
normalizeVersionedFrameworkSymlinks(stagedAppPath);
signAppBundle(stagedAppPath, "macOS companion app");
console.log(`Staged macOS companion app at ${path.relative(repoRoot, stagedAppPath)}`);
