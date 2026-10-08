const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");

// Exercise the actual main-process entry points without starting Electron or
// touching an installed CLI. Every unexpected filesystem/spawn access fails.
function entryPoint(start, end, globals) {
  const begin = main.indexOf(start);
  assert.ok(begin >= 0);
  const finish = main.indexOf(end, begin + start.length);
  assert.ok(finish > begin);
  const policyStart = main.indexOf("function isDeveloperInstallation()");
  const policyEnd = main.indexOf("const appIconPath", policyStart);
  const policy = main.slice(policyStart, policyEnd);
  return vm.runInNewContext(`${policy}\n(${main.slice(begin, finish).trim()})`, globals);
}

test("developer CLI resolution never falls back to a leftover standalone install", async () => {
  const resolve = entryPoint("async function resolveOpenbaseCoderCli(", "async function cliVersionDetail(", {
    developerDashboardOnly: true, cachedDevCliPath: null, IS_WINDOWS: false,
    shellCapture: async () => ({ code: 1, stdout: "" }),
    pathExists: () => assert.fail("standalone fallback attempted"),
  });
  const result = await resolve();
  assert.equal(result.path, null);
  assert.match(result.detail, /workspace/);
});

test("developer CLI resolution uses the workspace command", async () => {
  const resolve = entryPoint("async function resolveOpenbaseCoderCli(", "async function cliVersionDetail(", {
    developerDashboardOnly: true, cachedDevCliPath: null, IS_WINDOWS: false,
    shellCapture: async () => ({ code: 0, stdout: "/workspace/bin/openbase-coder\n" }),
  });
  assert.equal((await resolve()).path, "/workspace/bin/openbase-coder");
});

test("direct bundled activation is blocked in developer mode", async () => {
  const activate = entryPoint("async function activateBundledCliPackageOnce()", "const activateBundledCliPackage =", {
    developerDashboardOnly: true,
  });
  assert.equal((await activate()).activated, false);
});

test("desktop self-update command is blocked before resolving a leftover launcher", async () => {
  const command = entryPoint("async function commandWithOptions(", "async function runActivateCliCommand(", {
    developerDashboardOnly: true,
  });
  await assert.rejects(command("selfUpdate"), /git-managed/);
});

test("switching to developer mode during a seed copy prevents activation", async () => {
  const pointCurrent = entryPoint("async function pointCurrentAt(", "async function activateBundledCliPackageOnce()", {
    developerDashboardOnly: false,
    readActiveInstallation: () => ({ standalone: false }),
  });
  await assert.rejects(pointCurrent("/fixture/release"), /Developer installations/);
});

test("invalid installation metadata cannot enable release installation", () => {
  for (const contents of ["invalid", "null", "{}", "[]", '{"workspace_path":"/workspace"}']) {
    const read = entryPoint("function readActiveInstallation()", "const activeInstallation =", {
      fs: { readFileSync: () => contents }, path, os: { homedir: () => "/fixture" },
    });
    assert.equal(read().standalone, false);
  }
});

test("a packaged developer dashboard does not replace the VPN helper on launch", () => {
  const start = main.indexOf("void reconcileNetmeshHelperOnLaunch({");
  const end = main.indexOf("});", start) + 3;
  let enabled;
  vm.runInNewContext(main.slice(start, end), {
    nonDeveloperInstall: true, isDeveloperInstallation: () => true,
    process: { platform: "darwin" }, readTailnetConfigViaCli() {},
    netmeshCompanion: {}, mainLogger: {},
    reconcileNetmeshHelperOnLaunch: (options) => { enabled = options.enabled; },
  });
  assert.equal(enabled, false);
});

test("pausing quit for native staging keeps app control services alive", () => {
  const start = main.lastIndexOf('app.on("before-quit",');
  const end = main.indexOf('\napp.on("window-all-closed",', start);
  let callback;
  const calls = [];
  vm.runInNewContext(main.slice(start, end), {
    app: { on: (_event, handler) => { callback = handler; } },
    desktopControlServer: { stop: () => calls.push("control") },
    liveKitCompanion: { cleanup: () => calls.push("livekit") },
    netmeshCompanion: { cleanup: () => calls.push("netmesh") },
  });
  callback({ defaultPrevented: true });
  assert.deepEqual(calls, []);
  callback({ defaultPrevented: false });
  assert.deepEqual(calls, ["control", "livekit", "netmesh"]);
});


test("a competing runtime activation wins over desktop seed publication", async () => {
  const pointCurrent = entryPoint("async function pointCurrentAt(", "async function activateBundledCliPackageOnce()", {
    developerDashboardOnly: false, readActiveInstallation: () => ({ standalone: true }),
    STANDALONE_PACKAGE_ROOT: "/fixture/packages", STANDALONE_CURRENT_LINK: "/fixture/current", IS_WINDOWS: false,
    fsp: { mkdir: async () => {}, symlink: async () => { throw Object.assign(new Error("exists"), { code: "EEXIST" }); } },
    readPackageMetadata: async () => ({ version: "newer" }),
  });
  assert.equal(await pointCurrent("/fixture/older-seed"), false);
});
