// Freeze source identity before compiling, then bind it to linked Mach-O UUIDs
// before signing. Native processes compare against their loaded image, not a
// potentially replaced executable on disk.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export function captureNativeBuild(workspace, source) {
  if (process.env.CI || !existsSync(path.join(workspace, "multi.json"))) return null;
  let revision = null;
  try {
    if (existsSync(path.join(source, ".git"))) {
      revision = execFileSync("git", ["-C", source, "rev-parse", "--verify", "HEAD"], {
        encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    }
  } catch { /* Unavailable source evidence must remain unverified. */ }
  return {
    schema_version: 1,
    workspace_id: createHash("sha256").update(realpathSync(workspace)).digest("hex"),
    revisions: { "netmesh-macos": revision },
    verified: /^[0-9a-f]{40}$/.test(revision || "")
      && existsSync(path.join(workspace, "netmesh-macos"))
      && realpathSync(source) === realpathSync(path.join(workspace, "netmesh-macos")),
  };
}

export function finishNativeBuild(app, workspace, source, initial) {
  if (!initial) return;
  const final = captureNativeBuild(workspace, source);
  if (!initial.verified || JSON.stringify(initial) !== JSON.stringify(final)) {
    throw new Error("Native source commits changed during the build or cannot be verified; rebuild before staging.");
  }
  const executable = path.basename(app, ".app");
  const imageUUIDs = {};
  for (const name of [executable, "NetmeshHelper"]) {
    const output = execFileSync("xcrun", ["dwarfdump", "--uuid", path.join(app, "Contents/MacOS", name)], {
      encoding: "utf8", timeout: 10000,
    });
    const uuids = [...output.matchAll(/^UUID: ([0-9a-f-]{36}) /gim)].map(match => match[1].toUpperCase());
    if (!uuids.length) throw new Error(`Cannot identify the linked ${name} image.`);
    imageUUIDs[name] = uuids;
  }
  writeFileSync(path.join(app, "Contents/Resources/openbase-native-provenance.json"),
    JSON.stringify({ ...initial, image_uuids: imageUUIDs }) + "\n");
}

export function stageNativeBuild(builtApp, destination, workspace, source, initial, sign) {
  mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = mkdtempSync(path.join(path.dirname(destination), ".native-stage-"));
  const incoming = path.join(temporary, path.basename(destination));
  const previous = path.join(temporary, "previous.app");
  try {
    cpSync(builtApp, incoming, { recursive: true });
    finishNativeBuild(incoming, workspace, source, initial);
    execFileSync("xattr", ["-cr", incoming], { stdio: "inherit" });
    sign(incoming);
    execFileSync("codesign", ["--verify", "--deep", incoming], { stdio: "inherit" });
    // Never expose unsigned tools to concurrent status probes/watchdogs.
    if (existsSync(destination)) renameSync(destination, previous);
    try {
      renameSync(incoming, destination);
    } catch (error) {
      if (existsSync(previous)) renameSync(previous, destination);
      throw error;
    }
  } finally {
    // Preserve recovery evidence if even restoring the old bundle failed.
    if (!existsSync(previous) || existsSync(destination)) rmSync(temporary, { recursive: true, force: true });
  }
}
