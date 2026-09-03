const assert = require("node:assert/strict");
const test = require("node:test");

const { INSTALLER_EVENT_CHANNEL, sendInstallerEvent } = require("./installer-events.cjs");

test("installer events are sent while the onboarding window is alive", () => {
  const calls = [];
  const payload = { commandId: "setup", type: "start" };
  const sender = {
    isDestroyed: () => false,
    send: (...args) => calls.push(args),
  };

  assert.equal(sendInstallerEvent(sender, payload), true);
  assert.deepEqual(calls, [[INSTALLER_EVENT_CHANNEL, payload]]);
});

test("installer events are dropped after the onboarding window is destroyed", () => {
  const sender = {
    isDestroyed: () => true,
    send: () => assert.fail("destroyed webContents must not receive events"),
  };

  assert.equal(sendInstallerEvent(sender, { commandId: "setup", type: "exit" }), false);
});
