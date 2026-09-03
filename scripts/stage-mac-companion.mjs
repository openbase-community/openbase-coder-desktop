import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { signAppBundle } from "./macos-code-signing.mjs";

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

rmSync(stagedRoot, { force: true, recursive: true });
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
