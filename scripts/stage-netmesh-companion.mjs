// Builds OpenbaseNetmeshCompanion.app (the headless netmesh VPN driver that
// ships inside Openbase.app's Resources, replacing the standalone Openbase
// Netmesh app) from the netmesh-macos checkout and stages it into
// companion-build/ for electron-builder's extraResources.
//
// The closed-source netmesh companion is optional at build time: build from a
// netmesh-macos checkout when one is present (in-repo during the transition,
// or a sibling pointed at by OPENBASE_NETMESH_MACOS_DIR), keep an existing
// prebuilt at companion-build/OpenbaseNetmeshCompanion.app, or download the
// signed prebuilt published by the release pipeline. This is the boundary
// that lets the Electron app sources be public while netmesh stays closed —
// public contributors build the whole app from the downloaded artifact.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { signAppBundle, signExecutable } from "./macos-code-signing.mjs";
import { captureNativeBuild, stageNativeBuild } from "./native-provenance.mjs";
import {
  assertSupportedNetmeshBuild,
  resolveNetmeshPrebuiltPrefix,
} from "./netmesh-prebuilt-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const stagedRoot = path.join(repoRoot, "companion-build");
const stagedAppPath = path.join(stagedRoot, "OpenbaseNetmeshCompanion.app");

// Same bucket/prefix scheme as publish-s3.mjs; staging builds read the
// staging prefix so the two channels stay hermetic.
const packageVersion = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
).version;
const releasePrefix = resolveNetmeshPrebuiltPrefix(
  packageVersion,
  process.env.OPENBASE_CODER_RELEASE_PREFIX,
  process.env.OPENBASE_CODER_CLI_WEB_BACKEND_URL,
);
const COMPANION_ZIP_NAME = "OpenbaseNetmeshCompanion-latest-arm64.zip";
const prebuiltCompanionUrl =
  process.env.OPENBASE_NETMESH_COMPANION_URL ??
  `https://openbase-coder-desktop-releases-632795836081-us-east-1.s3.amazonaws.com/${releasePrefix}/${COMPANION_ZIP_NAME}`;

function verifyStagedCompanion() {
  const infoPlist = path.join(stagedAppPath, "Contents", "Info.plist");
  const build = execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleVersion", infoPlist],
    { encoding: "utf8" },
  );
  assertSupportedNetmeshBuild(build, "OpenbaseNetmeshCompanion");
}

function downloadPrebuiltCompanion() {
  const zipPath = path.join(stagedRoot, COMPANION_ZIP_NAME);
  mkdirSync(stagedRoot, { recursive: true });
  console.log(
    `[stage-netmesh-companion] downloading prebuilt companion from ${prebuiltCompanionUrl}`,
  );
  execFileSync("curl", ["-fL", "--retry", "3", "-o", zipPath, prebuiltCompanionUrl], {
    stdio: "inherit",
  });
  rmSync(stagedAppPath, { force: true, recursive: true });
  // ditto preserves the code signature and extended attributes; unzip may not.
  execFileSync("ditto", ["-x", "-k", zipPath, stagedRoot], { stdio: "inherit" });
  rmSync(zipPath, { force: true });
  if (!existsSync(stagedAppPath)) {
    throw new Error(
      `[stage-netmesh-companion] ${COMPANION_ZIP_NAME} did not contain OpenbaseNetmeshCompanion.app`,
    );
  }
  verifyStagedCompanion();
  execFileSync("codesign", ["--verify", "--deep", stagedAppPath], { stdio: "inherit" });
  console.log(`[stage-netmesh-companion] staged prebuilt ${stagedAppPath}`);
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
    verifyStagedCompanion();
    console.log(
      `[stage-netmesh-companion] keeping prebuilt companion at ${stagedAppPath}`,
    );
    process.exit(0);
  }
  downloadPrebuiltCompanion();
  process.exit(0);
}

const derivedDataPath = path.join(stagedRoot, "netmesh-derivedData");
const builtAppPath = path.join(
  derivedDataPath,
  "Build",
  "Products",
  "Release",
  "OpenbaseNetmeshCompanion.app",
);

console.log(`[stage-netmesh-companion] building from ${netmeshDir}`);

// The pinned Tailscale data-plane engine is a gitignored build artifact
// (~56 MB); build it via `go install` if it isn't present yet.
const vendorBin = path.join(netmeshDir, "vendor", "tailscale-bin");
const engineReady =
  existsSync(path.join(vendorBin, "tailscaled")) &&
  existsSync(path.join(vendorBin, "tailscale"));
if (!engineReady) {
  console.log("[stage-netmesh-companion] building pinned tailscale engine…");
  execFileSync("bash", [path.join(netmeshDir, "scripts", "build-tailscale.sh")], {
    cwd: netmeshDir,
    stdio: "inherit",
  });
}

const nativeBuild = captureNativeBuild(path.dirname(repoRoot), netmeshDir);
execFileSync("xcodegen", ["generate"], { cwd: netmeshDir, stdio: "inherit" });
execFileSync(
  "xcodebuild",
  [
    "-project",
    path.join(netmeshDir, "OpenbaseNetmesh.xcodeproj"),
    "-scheme",
    "OpenbaseNetmeshCompanion",
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
  console.error(`[stage-netmesh-companion] build product missing: ${builtAppPath}`);
  process.exit(1);
}

stageNativeBuild(builtAppPath, stagedAppPath, path.dirname(repoRoot), netmeshDir, nativeBuild, (app) => {
  for (const name of ["tailscale", "tailscaled"]) {
    signExecutable(path.join(app, "Contents/Resources", name), `bundled ${name}`);
  }
  for (const name of ["NetmeshHelper", "netmesh-ctl"]) {
    signExecutable(path.join(app, "Contents/MacOS", name), `bundled ${name}`);
  }
  signAppBundle(app, "macOS Netmesh companion app");
});
verifyStagedCompanion();
console.log(`[stage-netmesh-companion] staged ${stagedAppPath}`);
