const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { createAppUpdateController } = require("./app-updates.cjs");

function fixture(overrides = {}) {
  const policy = { appPackaged: true, ...overrides };
  let state = { status: "idle" };
  const updater = new EventEmitter();
  const calls = [];
  const scheduled = [];
  updater.checkForUpdates = async () => { calls.push("check"); };
  updater.quitAndInstall = () => calls.push("install");
  const controller = createAppUpdateController({
    autoUpdater: updater, getPolicy: () => policy, getState: () => state,
    setState: (patch) => { state = { ...state, ...patch }; },
    logger: { info() {} }, schedule: (callback) => scheduled.push(callback),
  });
  return { policy, updater, controller, calls, scheduled };
}

for (const [name, policy] of Object.entries({
  unpackaged: { appPackaged: false },
  "packaged developer build": { appDevBuild: true },
  "developer dashboard": { developerDashboardOnly: true },
  "active workspace installation": { installation: { standalone: false } },
  "environment opt-out": { disabledByEnv: "1" },
  "build-default opt-out": { disabledByDefaults: true },
})) {
  test(`${name} rejects startup, manual checks, and installation`, () => {
    const { controller, updater, calls, scheduled } = fixture(policy);
    assert.equal(controller.check().ok, false);
    assert.equal(controller.check().ok, false);
    assert.equal(controller.install().ok, false);
    assert.equal(controller.prepareForQuit(), false);
    assert.equal(updater.autoDownload, false);
    assert.equal(updater.autoInstallOnAppQuit, false);
    assert.deepEqual(calls, []);
    assert.deepEqual(scheduled, []);
  });
}

test("production install checks, downloads and explicitly installs", () => {
  const { controller, updater, calls, scheduled } = fixture({ installation: { standalone: true } });
  assert.equal(controller.check().ok, true);
  assert.equal(controller.check().ok, true);
  assert.equal(updater.listenerCount("update-downloaded"), 1);
  assert.equal(updater.autoDownload, true);
  assert.equal(controller.install().ok, false);
  updater.emit("update-downloaded", { version: "2.0" });
  assert.equal(updater.autoInstallOnAppQuit, false, "must not pre-arm Squirrel before a guarded quit");
  assert.equal(controller.install().ok, true);
  scheduled[0]();
  assert.deepEqual(calls, ["check", "check", "install"]);
});

test("switching to developer mode during download suppresses installation", () => {
  const { controller, updater, policy, calls } = fixture();
  controller.check();
  policy.installation = { standalone: false };
  updater.emit("update-downloaded", { version: "2.0" });
  assert.equal(controller.install().ok, false);
  assert.equal(controller.prepareForQuit(), false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.deepEqual(calls, ["check"]);
});

test("queued install rechecks mode before calling Electron", () => {
  const { controller, updater, policy, calls, scheduled } = fixture();
  controller.check();
  updater.emit("update-downloaded", { version: "2.0" });
  controller.install();
  policy.installation = { standalone: false };
  scheduled[0]();
  assert.deepEqual(calls, ["check"]);
  assert.equal(updater.autoInstallOnAppQuit, false);
});

test("ordinary production quit installs once, and lets the native updater finish quitting", () => {
  const { controller, updater, calls, scheduled } = fixture();
  controller.check();
  updater.emit("update-downloaded", { version: "2.0" });
  let prevented = 0;
  const event = { preventDefault: () => { prevented++; } };
  controller.beforeQuit(event);
  controller.beforeQuit(event);
  assert.equal(scheduled.length, 1);
  scheduled[0]();
  assert.deepEqual(calls, ["check", "install"]);
  controller.beforeQuit(event);
  assert.equal(prevented, 2);
});

test("developer switch after download allows an ordinary quit without handing off to Squirrel", () => {
  const { controller, updater, policy, calls, scheduled } = fixture();
  controller.check();
  updater.emit("update-downloaded", { version: "2.0" });
  assert.equal(updater.autoInstallOnAppQuit, false);
  policy.installation = { standalone: false };
  controller.beforeQuit({ preventDefault: () => assert.fail("developer quit prevented") });
  assert.deepEqual(calls, ["check"]);
  assert.deepEqual(scheduled, []);
});
