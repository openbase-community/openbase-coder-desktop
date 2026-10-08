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
  const timers = new Map();
  let timerId = 0;
  updater.checkForUpdates = async () => { calls.push("check"); };
  updater.quitAndInstall = () => calls.push("install");
  const controller = createAppUpdateController({
    autoUpdater: updater, getPolicy: () => policy, getState: () => state,
    setState: (patch) => { state = { ...state, ...patch }; },
    setTimer: (cb, delay) => { const id = ++timerId; timers.set(id, { cb, delay }); return id; },
    clearTimer: (id) => timers.delete(id),
    logger: { info() {} }, schedule: (callback) => scheduled.push(callback),
  });
  return { policy, updater, controller, calls, scheduled, timers, getState: () => state };
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
  assert.deepEqual(calls, ["check", "install"]);
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

const settled = () => new Promise((resolve) => setImmediate(resolve));

test("offline startup retries without restarting the app, then checks periodically", async () => {
  const f = fixture();
  let attempts = 0;
  f.updater.checkForUpdates = async () => {
    attempts++;
    if (attempts < 3) throw new Error("network unavailable");
    f.updater.emit("update-not-available");
  };
  f.controller.check();
  await settled();
  assert.equal(f.getState().status, "error");
  let timer = [...f.timers.values()][0];
  assert.equal(timer.delay, 60_000);
  f.timers.clear(); timer.cb();
  await settled();
  timer = [...f.timers.values()][0];
  assert.equal(timer.delay, 120_000);
  f.timers.clear(); timer.cb();
  await settled();
  assert.equal(attempts, 3);
  assert.equal([...f.timers.values()][0].delay, 6 * 60 * 60_000);
});

test("partial download retries, and download readiness stops the timer", async () => {
  const f = fixture();
  let fail;
  f.updater.checkForUpdates = async () => ({ downloadPromise: new Promise((_, reject) => { fail = reject; }) });
  f.controller.check();
  await settled();
  assert.equal(f.timers.size, 0);
  assert.equal(f.controller.install().ok, false);
  fail(new Error("connection reset halfway through zip"));
  await settled();
  assert.equal([...f.timers.values()][0].delay, 60_000);
  f.updater.checkForUpdates = async () => { f.updater.emit("update-downloaded", { version: "2" }); };
  const timer = [...f.timers.values()][0]; f.timers.clear(); timer.cb();
  await settled();
  assert.equal(f.getState().status, "downloaded");
  assert.equal(f.timers.size, 0);
});

test("pending network retry honors a developer switch", async () => {
  const f = fixture();
  f.updater.checkForUpdates = async () => { f.calls.push("check"); throw new Error("offline"); };
  f.controller.check();
  await settled();
  const timer = [...f.timers.values()][0]; f.timers.clear();
  f.policy.installation = { standalone: false };
  timer.cb();
  await settled();
  assert.deepEqual(f.calls, ["check"]);
  assert.equal(f.timers.size, 0);
});
