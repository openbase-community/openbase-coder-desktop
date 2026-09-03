// Build the human-download DMG with hdiutil. electron-builder's dmgbuild
// undersizes its staging volume for our 1.7GB app (bundled CLI seed), so we
// create the image from a staging folder instead — hdiutil sizes it itself.
//
// The DMG gets the polished drag-to-install layout: a branded Retina
// background ("Drag Openbase to Applications" with a large arrow), the
// app on the left, an Applications shortcut on the right, a fixed window with
// hidden toolbar/status bar, and a custom volume icon. The layout is written
// into the volume's .DS_Store by scripting Finder while a read-write image is
// mounted, then the image is converted to compressed read-only ULFO.
//
// Note for release machines: the Finder scripting step needs macOS Automation
// permission ("Terminal wants to control Finder") the first time it runs.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const version = pkg.version;
const appName = "Openbase.app";
const volumeName = `Openbase ${version}`;
const appPath = path.join(repoRoot, "release", "mac-arm64", appName);
const dmgPath = path.join(repoRoot, "release", `Openbase-${version}-arm64.dmg`);
const rwDmgPath = path.join(repoRoot, "release", `Openbase-${version}-arm64-rw.dmg`);
const stage = path.join(repoRoot, "release", "dmg-stage");
const backgroundTiff = path.join(repoRoot, "release", "dmg-resources", "background.tiff");
const volumeIcon = path.join(repoRoot, "assets", "openbase-coder-icon.icns");

// Keep in sync with assets/dmg/background.html: 660x400 canvas, icon centers
// at (165, 205) and (495, 205).
const WINDOW = { height: 400, left: 200, top: 120, width: 660 };
const ICON_SIZE = 128;
const APP_POSITION = { x: 165, y: 205 };
const APPLICATIONS_POSITION = { x: 495, y: 205 };
// Support files (.background, .fseventsd, .VolumeIcon.icns) are invisible to
// a default Finder, but park them well below the fold so the window stays
// clean even for users who show hidden files.
const HIDDEN_ITEM_POSITIONS = [
  { name: ".background", x: 165, y: 700 },
  { name: ".fseventsd", x: 330, y: 700 },
];
const VOLUME_ICON_PARK = { x: 495, y: 700 };

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
}

function generateBackground() {
  const electronBin = require("electron");
  run(electronBin, [path.join(__dirname, "generate-dmg-background.mjs")], {
    stdio: "inherit",
  });
  if (!existsSync(backgroundTiff)) {
    throw new Error(`DMG background was not generated at ${backgroundTiff}`);
  }
}

function stageContents() {
  rmSync(stage, { recursive: true, force: true });
  rmSync(dmgPath, { force: true });
  rmSync(rwDmgPath, { force: true });
  mkdirSync(stage, { recursive: true });
  cpSync(appPath, path.join(stage, appName), { recursive: true, verbatimSymlinks: true });
  symlinkSync("/Applications", path.join(stage, "Applications"));
  mkdirSync(path.join(stage, ".background"));
  cpSync(backgroundTiff, path.join(stage, ".background", "background.tiff"));
  // Pre-seeding .fseventsd with no_log keeps macOS from filling the volume's
  // event journal during the read-write layout session.
  mkdirSync(path.join(stage, ".fseventsd"));
  writeFileSync(path.join(stage, ".fseventsd", "no_log"), "");
}

function attachReadWrite() {
  const plist = run("hdiutil", ["attach", rwDmgPath, "-readwrite", "-noverify", "-noautoopen", "-plist"]);
  const match = plist.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/);
  if (!match) {
    throw new Error("Could not determine the mount point of the staging DMG.");
  }
  return match[1];
}

function applyFinderLayout() {
  const { left, top, width, height } = WINDOW;
  const script = `
tell application "Finder"
  tell disk "${volumeName}"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {${left}, ${top}, ${left + width}, ${top + height}}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to ${ICON_SIZE}
    set text size of viewOptions to 12
    set background picture of viewOptions to file ".background:background.tiff"
    set position of item "${appName}" of container window to {${APP_POSITION.x}, ${APP_POSITION.y}}
    set position of item "Applications" of container window to {${APPLICATIONS_POSITION.x}, ${APPLICATIONS_POSITION.y}}
${HIDDEN_ITEM_POSITIONS.map(
  (item) => `    try
      set position of item "${item.name}" of container window to {${item.x}, ${item.y}}
    end try`,
).join("\n")}
    update without registering applications
    delay 1
  end tell
end tell
`;
  run("osascript", ["-e", script], { stdio: "inherit" });
  settleIconPositions();
  run("osascript", ["-e", `tell application "Finder" to tell disk "${volumeName}" to close container window`], {
    stdio: "inherit",
  });
}

function readIconPositions() {
  const script = `
tell application "Finder"
  tell disk "${volumeName}"
    set p1 to position of item "${appName}" of container window
    set p2 to position of item "Applications" of container window
    return ((item 1 of p1) as text) & "," & ((item 2 of p1) as text) & "," & ((item 1 of p2) as text) & "," & ((item 2 of p2) as text)
  end tell
end tell
`;
  const output = run("osascript", ["-e", script]).trim();
  const [appX, appY, applicationsX, applicationsY] = output.split(/,\s*/).map(Number);
  return { app: { x: appX, y: appY }, applications: { x: applicationsX, y: applicationsY } };
}

function setIconPositions(appPosition, applicationsPosition) {
  const script = `
tell application "Finder"
  tell disk "${volumeName}"
    set position of item "${appName}" of container window to {${appPosition.x}, ${appPosition.y}}
    set position of item "Applications" of container window to {${applicationsPosition.x}, ${applicationsPosition.y}}
    update without registering applications
    delay 1
  end tell
end tell
`;
  run("osascript", ["-e", script], { stdio: "inherit" });
}

// Finder sometimes lands icons offset from the requested coordinates on a
// freshly created volume (observed as a constant vertical drift on first
// open). Read the positions back and write drift-compensated coordinates
// until they match the background artwork's anchors.
function settleIconPositions() {
  let appTarget = { ...APP_POSITION };
  let applicationsTarget = { ...APPLICATIONS_POSITION };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = readIconPositions();
    const appDrift = { x: actual.app.x - APP_POSITION.x, y: actual.app.y - APP_POSITION.y };
    const applicationsDrift = {
      x: actual.applications.x - APPLICATIONS_POSITION.x,
      y: actual.applications.y - APPLICATIONS_POSITION.y,
    };
    if (
      appDrift.x === 0 &&
      appDrift.y === 0 &&
      applicationsDrift.x === 0 &&
      applicationsDrift.y === 0
    ) {
      return;
    }
    console.warn(
      `Icon drift detected (app ${appDrift.x},${appDrift.y}; Applications ${applicationsDrift.x},${applicationsDrift.y}); compensating.`,
    );
    appTarget = { x: appTarget.x - appDrift.x, y: appTarget.y - appDrift.y };
    applicationsTarget = {
      x: applicationsTarget.x - applicationsDrift.x,
      y: applicationsTarget.y - applicationsDrift.y,
    };
    setIconPositions(appTarget, applicationsTarget);
  }
  throw new Error("Finder icon positions did not settle onto the background anchors.");
}

function applyCustomVolumeIcon(mountPoint) {
  // Must run AFTER the Finder layout pass: Finder's window update deletes a
  // pre-seeded .VolumeIcon.icns from the volume. The C attribute makes Finder
  // use the icon. SetFile ships with the Xcode Command Line Tools; a missing
  // tool only costs the volume icon.
  cpSync(volumeIcon, path.join(mountPoint, ".VolumeIcon.icns"));
  try {
    run("xcrun", ["SetFile", "-a", "C", mountPoint], { stdio: "inherit" });
  } catch {
    console.warn("SetFile unavailable; skipping the custom volume icon flag.");
  }
  // Best-effort: park the icon file below the fold too. Finder may refuse to
  // address it (for example once the container window is closed); the icon
  // still works without a stored position, so never fail the build over it.
  try {
    run(
      "osascript",
      [
        "-e",
        `tell application "Finder" to tell disk "${volumeName}" to set position of item ".VolumeIcon.icns" of container window to {${VOLUME_ICON_PARK.x}, ${VOLUME_ICON_PARK.y}}`,
      ],
      { stdio: "inherit" },
    );
  } catch {
    console.warn("Could not park .VolumeIcon.icns; leaving it unpositioned.");
  }
  if (!existsSync(path.join(mountPoint, ".VolumeIcon.icns"))) {
    console.warn("Finder removed .VolumeIcon.icns while parking it; restoring.");
    cpSync(volumeIcon, path.join(mountPoint, ".VolumeIcon.icns"));
  }
}

function detach(mountPoint) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      run("hdiutil", ["detach", mountPoint], { stdio: "inherit" });
      return;
    } catch (error) {
      if (attempt >= 5) {
        throw error;
      }
      console.warn(`Detach busy (attempt ${attempt}); retrying...`);
      // In-process synchronous sleep; no need to spawn a process for it.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    }
  }
}

if (!existsSync(appPath)) {
  console.error(`App not found at ${appPath}`);
  process.exit(1);
}

generateBackground();
stageContents();

run(
  "hdiutil",
  ["create", "-volname", volumeName, "-srcfolder", stage, "-ov", "-fs", "HFS+", "-format", "UDRW", rwDmgPath],
  { stdio: "inherit" },
);

const mountPoint = attachReadWrite();
try {
  applyFinderLayout();
  applyCustomVolumeIcon(mountPoint);
  run("sync", [], { stdio: "inherit" });
} finally {
  detach(mountPoint);
}

run("hdiutil", ["convert", rwDmgPath, "-format", "ULFO", "-o", dmgPath], { stdio: "inherit" });
rmSync(rwDmgPath, { force: true });
rmSync(stage, { recursive: true, force: true });
console.log(`Built ${dmgPath}`);
