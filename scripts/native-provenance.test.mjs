import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureNativeBuild, finishNativeBuild } from "./native-provenance.mjs";

test("native stamps bind source to linked images and reject a build race", { skip: process.platform !== "darwin" }, () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "native-provenance-"));
  const previousCI = process.env.CI;
  delete process.env.CI;
  try {
    writeFileSync(path.join(workspace, "multi.json"), "{}");
    const source = path.join(workspace, "netmesh-macos");
    mkdirSync(source);
    const git = (...args) => execFileSync("git", ["-C", source, ...args], { stdio: "pipe" });
    git("init", "-q");
    const commit = () => git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "Source");
    commit();
    const initial = captureNativeBuild(workspace, source);
    const app = path.join(workspace, "OpenbaseNetmesh.app");
    mkdirSync(path.join(app, "Contents/MacOS"), { recursive: true });
    mkdirSync(path.join(app, "Contents/Resources"));
    for (const name of ["OpenbaseNetmesh", "NetmeshHelper"]) cpSync("/usr/bin/true", path.join(app, "Contents/MacOS", name));
    finishNativeBuild(app, workspace, source, initial);
    const manifest = JSON.parse(readFileSync(path.join(app, "Contents/Resources/openbase-native-provenance.json")));
    assert.ok(manifest.image_uuids.NetmeshHelper.length);
    assert.equal(manifest.verified, true);
    assert.ok(!JSON.stringify(manifest).includes(workspace));
    commit();
    assert.throws(() => finishNativeBuild(app, workspace, source, initial), /changed during the build/);
    process.env.CI = "1";
    assert.equal(captureNativeBuild(workspace, source), null);
  } finally {
    if (previousCI === undefined) delete process.env.CI; else process.env.CI = previousCI;
    rmSync(workspace, { recursive: true, force: true });
  }
});
