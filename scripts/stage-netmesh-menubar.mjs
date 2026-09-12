// Builds OpenbaseNetmesh.app (the Swift status menu-bar UI that pairs with
// the desktop app on every install pathway) from the netmesh-macos checkout
// and stages it into companion-build/ for electron-builder's extraResources,
// so standalone (DMG) installs carry it inside Openbase.app's Resources.
//
// Mirrors stage-netmesh-companion.mjs: the closed-source netmesh checkout is
// optional at build time — build from a netmesh-macos checkout when one is
// present (in-repo, or a sibling pointed at by OPENBASE_NETMESH_MACOS_DIR),
// keep an existing prebuilt at companion-build/OpenbaseNetmesh.app, or
// download the signed prebuilt published by the release pipeline. This is the
// boundary that lets the Electron app sources be public while netmesh stays
// closed — public contributors build the whole app from the downloaded
// artifact.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { signAppBundle, signExecutable } from "./macos-code-signing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const stagedRoot = path.join(repoRoot, "companion-build");
const stagedAppPath = path.join(stagedRoot, "OpenbaseNetmesh.app");

// Same bucket/prefix scheme as publish-s3.mjs; staging builds read the
// staging prefix so the two channels stay hermetic.
const releasePrefix = process.env.OPENBASE_CODER_RELEASE_PREFIX ?? "mac";
const MENUBAR_ZIP_NAME = "OpenbaseNetmesh-latest-arm64.zip";
const prebuiltMenuBarUrl =
  process.env.OPENBASE_NETMESH_MENUBAR_URL ??
  `https://openbase-coder-desktop-releases-632795836081-us-east-1.s3.amazonaws.com/${releasePrefix}/${MENUBAR_ZIP_NAME}`;

function downloadPrebuiltMenuBarApp() {
  const zipPath = path.join(stagedRoot, MENUBAR_ZIP_NAME);
  mkdirSync(stagedRoot, { recursive: true });
  console.log(
    `[stage-netmesh-menubar] downloading prebuilt menu-bar app from ${prebuiltMenuBarUrl}`,
  );
  execFileSync("curl", ["-fL", "--retry", "3", "-o", zipPath, prebuiltMenuBarUrl], {
    stdio: "inherit",
  });
  rmSync(stagedAppPath, { force: true, recursive: true });
  // ditto preserves the code signature and extended attributes; unzip may not.
  execFileSync("ditto", ["-x", "-k", zipPath, stagedRoot], { stdio: "inherit" });
  rmSync(zipPath, { force: true });
  if (!existsSync(stagedAppPath)) {
    throw new Error(
      `[stage-netmesh-menubar] ${MENUBAR_ZIP_NAME} did not contain OpenbaseNetmesh.app`,
    );
  }
  execFileSync("codesign", ["--verify", "--deep", stagedAppPath], { stdio: "inherit" });
  console.log(`[stage-netmesh-menubar] staged prebuilt ${stagedAppPath}`);
}

const netmeshDirCandidates = [
  process.env.OPENBASE_NETMESH_MACOS_DIR,
  path.resolve(repoRoot, "netmesh-macos"),
  // Workspace sibling checkout (the internal install set clones the private
  // repo next to this one); public checkouts fall through to the prebuilt.
  path.resolve(repoRoot, "..", "netmesh-macos"),
].filter(Boolean);
const netmeshDir = netmeshDirCandidates.find((candidate) =>
  existsSync(path.join(candidate, "project.yml")),
);

if (!netmeshDir) {
  if (existsSync(stagedAppPath)) {
    console.log(
      `[stage-netmesh-menubar] keeping prebuilt menu-bar app at ${stagedAppPath}`,
    );
    process.exit(0);
  }
  downloadPrebuiltMenuBarApp();
  process.exit(0);
}

const derivedDataPath = path.join(stagedRoot, "netmesh-menubar-derivedData");
const builtAppPath = path.join(
  derivedDataPath,
  "Build",
  "Products",
  "Release",
  "OpenbaseNetmesh.app",
);

console.log(`[stage-netmesh-menubar] building from ${netmeshDir}`);

// The pinned Tailscale data-plane engine is a gitignored build artifact
// (~56 MB); build it via `go install` if it isn't present yet.
const vendorBin = path.join(netmeshDir, "vendor", "tailscale-bin");
const engineReady =
  existsSync(path.join(vendorBin, "tailscaled")) &&
  existsSync(path.join(vendorBin, "tailscale"));
if (!engineReady) {
  console.log("[stage-netmesh-menubar] building pinned tailscale engine…");
  execFileSync("bash", [path.join(netmeshDir, "scripts", "build-tailscale.sh")], {
    cwd: netmeshDir,
    stdio: "inherit",
  });
}

execFileSync("xcodegen", ["generate"], { cwd: netmeshDir, stdio: "inherit" });
execFileSync(
  "xcodebuild",
  [
    "-project",
    path.join(netmeshDir, "OpenbaseNetmesh.xcodeproj"),
    "-scheme",
    "OpenbaseNetmesh",
    "-configuration",
    "Release",
    "-derivedDataPath",
    derivedDataPath,
    "CODE_SIGNING_ALLOWED=NO",
    "CODE_SIGNING_REQUIRED=NO",
    "CODE_SIGN_IDENTITY=",
    "build",
  ],
  { cwd: netmeshDir, stdio: "inherit" },
);

if (!existsSync(builtAppPath)) {
  console.error(`[stage-netmesh-menubar] build product missing: ${builtAppPath}`);
  process.exit(1);
}

rmSync(stagedAppPath, { force: true, recursive: true });
mkdirSync(stagedRoot, { recursive: true });
cpSync(builtAppPath, stagedAppPath, { recursive: true });
for (const resourceExecutable of ["tailscale", "tailscaled"]) {
  signExecutable(
    path.join(stagedAppPath, "Contents", "Resources", resourceExecutable),
    `bundled ${resourceExecutable}`,
  );
}
for (const embeddedExecutable of ["NetmeshHelper", "netmesh-ctl"]) {
  signExecutable(
    path.join(stagedAppPath, "Contents", "MacOS", embeddedExecutable),
    `embedded ${embeddedExecutable}`,
  );
}
signAppBundle(stagedAppPath, "macOS Netmesh menu-bar app");
console.log(`[stage-netmesh-menubar] staged ${stagedAppPath}`);
