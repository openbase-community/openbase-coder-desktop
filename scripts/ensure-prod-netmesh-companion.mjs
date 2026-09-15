// Ensure the prod (`mac/`) Netmesh prebuilts satisfy the desktop contract
// before the DMG build stages them.
//
// The macOS DMG build downloads the signed Netmesh companion + menu-bar apps
// from the release bucket's `mac/` prefix and asserts
// CFBundleVersion >= MINIMUM_NETMESH_BUILD (see netmesh-prebuilt-contract.mjs).
// Only source-checkout builds publish those artifacts (public CI just
// downloads), and they land in `mac-staging/`. So every time the minimum is
// bumped, prod `mac/` lags the new build and the first prod DMG fails
// ("build N is too old") until someone hand-copies mac-staging -> mac. This
// has now recurred for builds 15, 16, and 17.
//
// netmesh-macos is pinned @main for every channel, so the `mac-staging`
// artifact IS the exact build prod needs. When prod is stale, promote it here
// — verifying the build number and the Developer ID signature first — so the
// manual copy step disappears. No-ops when prod already satisfies the
// contract. Fails loudly if `mac-staging` is ALSO too old (a real gap: the new
// companion was never published anywhere).
//
// Runs only for prod (`mac`) builds; on staging, `mac-staging` is the source
// of truth and there is nothing to promote.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MINIMUM_NETMESH_BUILD } from "./netmesh-prebuilt-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK_ONLY = process.argv.includes("--check");

const ARTIFACTS = [
  { zip: "OpenbaseNetmeshCompanion-latest-arm64.zip", app: "OpenbaseNetmeshCompanion.app" },
  { zip: "OpenbaseNetmesh-latest-arm64.zip", app: "OpenbaseNetmesh.app" },
];

function resolveBucket() {
  if (process.env.OPENBASE_CODER_RELEASE_BUCKET) {
    return process.env.OPENBASE_CODER_RELEASE_BUCKET;
  }
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const url = pkg.build?.publish?.url ?? "";
  const match = /^https:\/\/([^./]+)\.s3\.amazonaws\.com\//.exec(url);
  if (!match) {
    throw new Error(
      "Could not resolve the release bucket from package.json build.publish.url; " +
        "set OPENBASE_CODER_RELEASE_BUCKET.",
    );
  }
  return match[1];
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], ...opts })
    .toString()
    .trim();
}

// Download s3://bucket/prefix/zip, extract, and return { build, appPath } — or
// null when the object is absent.
function inspect(bucket, prefix, artifact, workDir) {
  const dir = path.join(workDir, prefix, artifact.zip);
  const zipPath = path.join(dir, artifact.zip);
  run("mkdir", ["-p", dir]);
  try {
    execFileSync(
      "aws",
      ["s3", "cp", `s3://${bucket}/${prefix}/${artifact.zip}`, zipPath, "--quiet"],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
  } catch {
    return null;
  }
  run("ditto", ["-x", "-k", zipPath, dir]);
  const appPath = path.join(dir, artifact.app);
  if (!existsSync(appPath)) return null;
  const build = run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleVersion",
    path.join(appPath, "Contents", "Info.plist"),
  ]);
  return { build: Number(build), appPath };
}

function ensureSignedByTeam(appPath) {
  // Reject anything not validly signed by our Developer ID before copying it
  // to the prod channel that public installs download.
  run("codesign", ["--verify", "--deep", "--strict", appPath]);
  // codesign -dvv writes its details to stderr; merge it in to read Authority.
  const details = execFileSync("bash", ["-c", `codesign -dvv "${appPath}" 2>&1`]).toString();
  if (!/Authority=Developer ID Application:/.test(details)) {
    throw new Error(`${appPath} is not signed with a Developer ID Application certificate`);
  }
}

function main() {
  const bucket = resolveBucket();
  const workDir = mkdtempSync(path.join(tmpdir(), "netmesh-prod-check-"));
  let promoted = 0;
  try {
    for (const artifact of ARTIFACTS) {
      const prod = inspect(bucket, "mac", artifact, workDir);
      if (prod && prod.build >= MINIMUM_NETMESH_BUILD) {
        console.log(`[ensure-netmesh] mac/${artifact.zip}: build ${prod.build} OK (>= ${MINIMUM_NETMESH_BUILD})`);
        continue;
      }
      const have = prod ? `build ${prod.build}` : "missing";
      const staging = inspect(bucket, "mac-staging", artifact, workDir);
      if (!staging || staging.build < MINIMUM_NETMESH_BUILD) {
        const stagingHave = staging ? `build ${staging.build}` : "missing";
        throw new Error(
          `mac/${artifact.zip} is ${have} (needs >= ${MINIMUM_NETMESH_BUILD}) and ` +
            `mac-staging is ${stagingHave} — no publishable build exists. Build and ` +
            `publish the netmesh companion (netmesh-macos @main is build ${staging?.build ?? "?"}).`,
        );
      }
      ensureSignedByTeam(staging.appPath);
      console.log(
        `[ensure-netmesh] mac/${artifact.zip}: ${have}; promoting mac-staging build ${staging.build} -> mac`,
      );
      if (!CHECK_ONLY) {
        execFileSync(
          "aws",
          [
            "s3",
            "cp",
            `s3://${bucket}/mac-staging/${artifact.zip}`,
            `s3://${bucket}/mac/${artifact.zip}`,
            "--cache-control",
            "public, max-age=300",
          ],
          { stdio: ["ignore", "inherit", "inherit"] },
        );
      }
      promoted += 1;
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  console.log(
    `[ensure-netmesh] done — ${promoted} artifact(s) ${CHECK_ONLY ? "would be " : ""}promoted from mac-staging`,
  );
}

main();
