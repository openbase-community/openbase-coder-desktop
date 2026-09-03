const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  LINUX_ONBOARDING_HELPER,
  LINUX_TAILSCALE_PATH,
  markLinuxTailscaleOnboardingReady,
  READY_MARKER_NAME,
  runLinuxTailscalePostConnect,
  SUDO_PATH,
  runLinuxTailscaleOnboarding,
} = require("./linux-tailscale-onboarding.cjs");

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test("Darwin is rejected without spawning or opening anything", async () => {
  let spawned = false;
  let opened = false;
  let registrationCalls = 0;

  const result = await runLinuxTailscaleOnboarding({
    onConnected: async () => {
      registrationCalls += 1;
    },
    openExternal: async () => {
      opened = true;
    },
    platform: "darwin",
    spawnProcess: () => {
      spawned = true;
    },
  });

  assert.equal(result.supported, false);
  assert.equal(result.ok, false);
  assert.equal(spawned, false);
  assert.equal(opened, false);
  assert.equal(registrationCalls, 0);
});

test("Darwin does not write the Linux readiness marker", () => {
  let written = false;
  const marked = markLinuxTailscaleOnboardingReady({
    platform: "darwin",
    writeFile: () => {
      written = true;
    },
  });

  assert.equal(marked, false);
  assert.equal(written, false);
});

test("Darwin cannot run Linux post-connect commands", async () => {
  let commandCalls = 0;

  await assert.rejects(
    runLinuxTailscalePostConnect({
      cliPath: "/example/openbase-coder",
      platform: "darwin",
      runCommand: async () => {
        commandCalls += 1;
        return { code: 0, stderr: "", stdout: "" };
      },
    }),
    /only on Linux/,
  );
  assert.equal(commandCalls, 0);
});

test("Linux configures and verifies Serve before cloud registration", async () => {
  const calls = [];
  const cliPath = "/home/ubuntu/.openbase/cli/current/bin/openbase-coder";
  const results = [
    { code: 0, stderr: "", stdout: "" },
    { code: 0, stderr: "", stdout: "" },
    {
      code: 0,
      stderr: "",
      stdout: JSON.stringify({ tailscale_serve: { healthy: true } }),
    },
    { code: 0, stderr: "", stdout: "Registered device." },
  ];

  await runLinuxTailscalePostConnect({
    cliPath,
    platform: "linux",
    runCommand: async (bin, args) => {
      calls.push({ args, bin });
      return results.shift();
    },
  });

  assert.deepEqual(calls, [
    {
      args: ["serve", "--bg", "--http=18080", "http://127.0.0.1:7999"],
      bin: LINUX_TAILSCALE_PATH,
    },
    {
      args: ["serve", "--bg", "--tcp=7880", "tcp://127.0.0.1:7880"],
      bin: LINUX_TAILSCALE_PATH,
    },
    { args: ["onboarding", "status", "--json"], bin: cliPath },
    { args: ["onboarding", "report"], bin: cliPath },
  ]);
});

test("Linux reports an unhealthy Serve configuration and fails onboarding", async () => {
  const calls = [];
  const results = [
    { code: 0, stderr: "", stdout: "" },
    { code: 0, stderr: "", stdout: "" },
    {
      code: 0,
      stderr: "",
      stdout: JSON.stringify({
        tailscale_serve: { error: "route missing", healthy: false },
      }),
    },
    { code: 0, stderr: "", stdout: "Registered device." },
  ];

  await assert.rejects(
    runLinuxTailscalePostConnect({
      cliPath: "/example/openbase-coder",
      platform: "linux",
      runCommand: async (bin, args) => {
        calls.push({ args, bin });
        return results.shift();
      },
    }),
    /route missing/,
  );
  assert.deepEqual(calls.at(-1), {
    args: ["onboarding", "report"],
    bin: "/example/openbase-coder",
  });
});

test("Linux writes a per-session readiness marker for the AMI fallback", () => {
  const writes = [];
  const marked = markLinuxTailscaleOnboardingReady({
    platform: "linux",
    runtimeDir: "/run/user/1000",
    writeFile: (...args) => writes.push(args),
  });

  assert.equal(marked, true);
  assert.equal(writes[0][0], `/run/user/1000/${READY_MARKER_NAME}`);
  assert.equal(writes[0][1], "ready\n");
});

test("Linux runs only the fixed passwordless helper and opens the Tailscale login URL", async () => {
  const child = fakeChild();
  const calls = [];
  const opened = [];
  let registrationCalls = 0;

  const resultPromise = runLinuxTailscaleOnboarding({
    onConnected: async () => {
      registrationCalls += 1;
    },
    openExternal: async (url) => opened.push(url),
    platform: "linux",
    spawnProcess: (command, args, options) => {
      calls.push({ args, command, options });
      return child;
    },
  });

  child.stderr.emit("data", Buffer.from("To authenticate, visit:\nhttps://login.tail"));
  child.stderr.emit("data", Buffer.from("scale.com/a/abc123\n"));
  child.emit("close", 0, null);
  const result = await resultPromise;

  assert.deepEqual(calls.map(({ command, args }) => ({ command, args })), [
    { command: SUDO_PATH, args: ["-n", LINUX_ONBOARDING_HELPER] },
  ]);
  assert.deepEqual(opened, ["https://login.tailscale.com/a/abc123"]);
  assert.equal(registrationCalls, 1);
  assert.deepEqual(result, {
    authUrlOpened: true,
    ok: true,
    registrationCompleted: true,
    supported: true,
  });
});

test("Linux does not open non-Tailscale URLs emitted by the helper", async () => {
  const child = fakeChild();
  const opened = [];

  const resultPromise = runLinuxTailscaleOnboarding({
    openExternal: async (url) => opened.push(url),
    platform: "linux",
    spawnProcess: () => child,
  });

  child.stdout.emit("data", Buffer.from("https://example.com/not-authorized\n"));
  child.emit("close", 0, null);
  const result = await resultPromise;

  assert.deepEqual(opened, []);
  assert.deepEqual(result, {
    authUrlOpened: false,
    ok: true,
    registrationCompleted: false,
    supported: true,
  });
});

test("Linux surfaces registration failure after Tailscale connects", async () => {
  const child = fakeChild();
  const resultPromise = runLinuxTailscaleOnboarding({
    onConnected: async () => {
      throw new Error("Login required.");
    },
    openExternal: async () => undefined,
    platform: "linux",
    spawnProcess: () => child,
  });

  child.emit("close", 0, null);
  const result = await resultPromise;

  assert.equal(result.ok, false);
  assert.equal(result.registrationFailed, true);
  assert.match(result.error, /Login required/);
});

test("Linux does not register when the Tailscale helper fails", async () => {
  const child = fakeChild();
  let registrationCalls = 0;
  const resultPromise = runLinuxTailscaleOnboarding({
    onConnected: async () => {
      registrationCalls += 1;
    },
    openExternal: async () => undefined,
    platform: "linux",
    spawnProcess: () => child,
  });

  child.emit("close", 1, null);
  const result = await resultPromise;

  assert.equal(result.ok, false);
  assert.equal(registrationCalls, 0);
});

test("Linux reports a missing passwordless privilege rule clearly", async () => {
  const child = fakeChild();
  const resultPromise = runLinuxTailscaleOnboarding({
    openExternal: async () => undefined,
    platform: "linux",
    spawnProcess: () => child,
  });

  child.stderr.emit("data", Buffer.from("sudo: a password is required\n"));
  child.emit("close", 1, null);
  const result = await resultPromise;

  assert.equal(result.ok, false);
  assert.match(result.error, /privilege helper is unavailable/i);
});

test("Linux failure results redact one-time Tailscale login URLs", async () => {
  const child = fakeChild();
  const resultPromise = runLinuxTailscaleOnboarding({
    openExternal: async () => undefined,
    platform: "linux",
    spawnProcess: () => child,
  });

  child.stderr.emit("data", Buffer.from("https://login.tailscale.com/a/one-time\ntimed out\n"));
  child.emit("close", 1, null);
  const result = await resultPromise;

  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /login\.tailscale\.com/);
  assert.match(result.error, /\[Tailscale login URL\]/);
});
