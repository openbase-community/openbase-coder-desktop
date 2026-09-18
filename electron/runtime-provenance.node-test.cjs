const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { captureDesktopProvenance } = require("./runtime-provenance.cjs");

test("production never reads developer metadata", () => {
  assert.equal(captureDesktopProvenance({ appPackaged: true, nonDeveloperInstall: true, desktopDir: "/missing" }), null);
});

test("packaged development main requires its own verified file contents", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-stamp-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "dist"));
  fs.mkdirSync(path.join(root, "electron"));
  fs.writeFileSync(path.join(root, "electron/main.cjs"), "original");
  const stamp = { schema_version: 1, component: "desktop-main", verified: true, files: { "main.cjs": createHash("sha256").update("original").digest("hex") } };
  fs.writeFileSync(path.join(root, "dist/desktop-main-provenance.json"), JSON.stringify(stamp));
  const options = { appPackaged: true, nonDeveloperInstall: false, desktopDir: root };
  assert.equal(captureDesktopProvenance(options).verified, true);
  fs.writeFileSync(path.join(root, "electron/main.cjs"), "changed after build");
  assert.equal(captureDesktopProvenance(options), null);
});
