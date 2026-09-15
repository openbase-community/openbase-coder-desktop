const assert = require("node:assert/strict");
const test = require("node:test");
const { reconcileNetmeshHelperOnLaunch } = require("./netmesh-launch-reconciliation.cjs");

function recordingLogger() {
  const events = [];
  return {
    events,
    info(event, payload) {
      events.push({ level: "info", event, payload });
    },
    error(event, payload) {
      events.push({ level: "error", event, payload });
    },
  };
}

test("reconciles the helper for an existing Netmesh installation", async () => {
  const logger = recordingLogger();
  let registrations = 0;

  const result = await reconcileNetmeshHelperOnLaunch({
    enabled: true,
    readTailnetConfig: async () => ({ ok: true, provider: "netmesh" }),
    register: async () => {
      registrations += 1;
      return { ok: true, helper: "enabled", helperReplaced: true };
    },
    logger,
  });

  assert.equal(registrations, 1);
  assert.equal(result.helperReplaced, true);
  assert.deepEqual(logger.events, [
    {
      level: "info",
      event: "netmesh-helper-launch-reconciled",
      payload: { helper: "enabled", helperReplaced: true },
    },
  ]);
});

test("does not start Netmesh for another provider", async () => {
  let registrations = 0;

  const result = await reconcileNetmeshHelperOnLaunch({
    enabled: true,
    readTailnetConfig: async () => ({ ok: true, provider: "netmesh-tsnet" }),
    register: async () => {
      registrations += 1;
    },
    logger: recordingLogger(),
  });

  assert.equal(result, null);
  assert.equal(registrations, 0);
});

test("logs reconciliation failure without aborting desktop launch", async () => {
  const logger = recordingLogger();

  const result = await reconcileNetmeshHelperOnLaunch({
    enabled: true,
    readTailnetConfig: async () => ({ ok: true, provider: "netmesh" }),
    register: async () => ({ ok: false, error: "replacement unavailable" }),
    logger,
    maxAttempts: 1,
  });

  assert.equal(result, null);
  assert.deepEqual(logger.events, [
    {
      level: "error",
      event: "netmesh-helper-launch-reconciliation-error",
      payload: { message: "replacement unavailable" },
    },
  ]);
});

test("retries a transient helper failure during app relaunch", async () => {
  const logger = recordingLogger();
  const waits = [];
  let registrations = 0;

  const result = await reconcileNetmeshHelperOnLaunch({
    enabled: true,
    readTailnetConfig: async () => ({ ok: true, provider: "netmesh" }),
    register: async () => {
      registrations += 1;
      if (registrations === 1) {
        return { ok: false, error: "helper is still restarting" };
      }
      return { ok: true, helper: "enabled", helperReplaced: false };
    },
    logger,
    wait: async (ms) => waits.push(ms),
  });

  assert.equal(registrations, 2);
  assert.deepEqual(waits, [1000]);
  assert.equal(result.helper, "enabled");
  assert.deepEqual(logger.events, [
    {
      level: "info",
      event: "netmesh-helper-launch-reconciliation-retrying",
      payload: {
        attempt: 1,
        maxAttempts: 3,
        message: "helper is still restarting",
      },
    },
    {
      level: "info",
      event: "netmesh-helper-launch-reconciled",
      payload: { helper: "enabled", helperReplaced: false },
    },
  ]);
});
