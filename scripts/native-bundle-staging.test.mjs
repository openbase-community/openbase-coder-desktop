import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { downloadNativeBundle, publishNativeBundle, stageNativeBundle } from "./native-bundle-staging.mjs";

const mac = { skip: process.platform !== "darwin" };
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "bundle-publication-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function bundle(app, version, signed = true) {
  mkdirSync(path.join(app, "Contents/MacOS"), { recursive: true });
  mkdirSync(path.join(app, "Contents/Resources"));
  writeFileSync(path.join(app, "Contents/Info.plist"), `<?xml version="1.0"?><plist version="1.0"><dict>
    <key>CFBundleIdentifier</key><string>invalid.example.bundle-test</string>
    <key>CFBundleExecutable</key><string>Fixture</string>
    <key>CFBundleVersion</key><string>${version}</string>
    <key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
  cpSync("/usr/bin/true", path.join(app, "Contents/MacOS/Fixture"));
  writeFileSync(path.join(app, "Contents/Resources/version"), version);
  if (signed) execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "pipe" });
}
const version = app => readFileSync(path.join(app, "Contents/Resources/version"), "utf8");

test("first publication and replacement preserve the outgoing sealed bundle", mac, t => {
  const root = fixture(t);
  const live = path.join(root, "App.app");
  stageNativeBundle(live, incoming => bundle(incoming, "1"));
  assert.equal(version(live), "1");
  const oldInode = statSync(path.join(live, "Contents/MacOS/Fixture")).ino;
  stageNativeBundle(live, incoming => {
    bundle(incoming, "2");
    assert.equal(version(live), "1");
  });
  assert.equal(version(live), "2");
  const retained = readdirSync(root).filter(name => name.startsWith(".native-stage-"));
  assert.equal(retained.length, 1);
  const old = path.join(root, retained[0], "App.app");
  assert.equal(version(old), "1");
  assert.equal(statSync(path.join(old, "Contents/MacOS/Fixture")).ino, oldInode);
  assert.notEqual(statSync(path.join(live, "Contents/MacOS/Fixture")).ino, oldInode);
  execFileSync("codesign", ["--verify", "--strict", "--deep", old]);
});

test("preparation, signature and missing-bundle rejection leave live unchanged", mac, t => {
  const root = fixture(t);
  const live = path.join(root, "App.app");
  bundle(live, "1");
  for (const prepare of [
    incoming => { bundle(incoming, "2"); throw new Error("interrupted preparation"); },
    incoming => { bundle(incoming, "2"); writeFileSync(path.join(incoming, "Contents/Resources/version"), "tampered"); },
    () => {},
  ]) {
    assert.throws(() => stageNativeBundle(live, prepare));
    assert.equal(version(live), "1");
    assert.deepEqual(readdirSync(root), ["App.app"]);
  }
});

test("download extraction and validation finish before publication", mac, t => {
  const root = fixture(t);
  const live = path.join(root, "live/App.app");
  const built = path.join(root, "build/App.app");
  bundle(live, "1");
  bundle(built, "2");
  const zip = path.join(root, "bundle.zip");
  execFileSync("ditto", ["-c", "-k", "--keepParent", built, zip]);
  const url = new URL(`file://${zip}`).href;
  assert.throws(() => downloadNativeBundle(live, url, "download.zip", incoming => {
    assert.equal(version(incoming), "2");
    assert.equal(version(live), "1");
    throw new Error("unsupported version");
  }), /unsupported version/);
  assert.equal(version(live), "1");
  downloadNativeBundle(live, url, "download.zip", incoming => assert.equal(version(incoming), "2"));
  assert.equal(version(live), "2");
  writeFileSync(zip, readFileSync(zip).subarray(0, 100));
  assert.throws(() => downloadNativeBundle(live, url, "download.zip", () => {}));
  assert.equal(version(live), "2");
});

test("failed atomic publication leaves the existing destination present", mac, t => {
  const root = fixture(t);
  const live = path.join(root, "App.app");
  bundle(live, "1");
  assert.throws(() => publishNativeBundle(path.join(root, "missing.app"), live, root));
  assert.equal(version(live), "1");
});

test("concurrent readers never see a missing path during repeated directory exchanges", mac, async t => {
  const root = fixture(t);
  const incoming = path.join(root, "incoming.app");
  const live = path.join(root, "App.app");
  bundle(live, "1", false);
  bundle(incoming, "2", false);
  publishNativeBundle(incoming, live, root);
  const state = new Int32Array(new SharedArrayBuffer(16));
  const worker = new Worker(`
    const { workerData } = require('node:worker_threads');
    const { readFileSync } = require('node:fs');
    const state = new Int32Array(workerData.state);
    Atomics.store(state, 0, 1); Atomics.notify(state, 0);
    while (!Atomics.load(state, 1)) {
      try {
        const value = readFileSync(workerData.file, 'utf8');
        if (value !== '1' && value !== '2') Atomics.add(state, 2, 1);
      } catch { Atomics.add(state, 2, 1); }
      Atomics.add(state, 3, 1);
    }
  `, { eval: true, workerData: { state: state.buffer, file: path.join(live, "Contents/Resources/version") } });
  const exited = new Promise((resolve, reject) => { worker.on("exit", resolve); worker.on("error", reject); });
  try {
    Atomics.wait(state, 0, 0, 5000);
    assert.equal(Atomics.load(state, 0), 1);
    for (let i = 0; i < 30; i++) execFileSync(path.join(root, "bundle-swap"), [incoming, live]);
  } finally { Atomics.store(state, 1, 1); await exited; }
  assert.ok(Atomics.load(state, 3) > 0);
  assert.equal(Atomics.load(state, 2), 0);
  assert.ok(existsSync(incoming));
});
