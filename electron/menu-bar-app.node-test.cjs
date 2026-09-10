const assert = require("node:assert/strict");
const test = require("node:test");

const { findMenuBarApp, menuBarAppCandidates } = require("./menu-bar-app.cjs");

const packagedDevOptions = {
  electronDir: "/Applications/Openbase.app/Contents/Resources/app.asar/electron",
  envPath: undefined,
  resourcesPath: "/Applications/Openbase.app/Contents/Resources",
  workspacePath: "/workspace",
};

test("a packaged developer install resolves the workspace build products", () => {
  const existing = new Set([
    "/workspace/netmesh-macos/DerivedData/Build/Products/Debug/OpenbaseNetmesh.app",
  ]);
  assert.equal(
    findMenuBarApp(packagedDevOptions, (candidate) => existing.has(candidate)),
    "/workspace/netmesh-macos/DerivedData/Build/Products/Debug/OpenbaseNetmesh.app",
  );
});

test("a Release workspace build wins over Debug", () => {
  const existing = new Set([
    "/workspace/netmesh-macos/DerivedData/Build/Products/Debug/OpenbaseNetmesh.app",
    "/workspace/netmesh-macos/DerivedData/Build/Products/Release/OpenbaseNetmesh.app",
  ]);
  assert.equal(
    findMenuBarApp(packagedDevOptions, (candidate) => existing.has(candidate)),
    "/workspace/netmesh-macos/DerivedData/Build/Products/Release/OpenbaseNetmesh.app",
  );
});

test("a standalone install resolves the bundled Resources copy", () => {
  const existing = new Set([
    "/Applications/Openbase.app/Contents/Resources/OpenbaseNetmesh.app",
  ]);
  assert.equal(
    findMenuBarApp(
      { ...packagedDevOptions, workspacePath: undefined },
      (candidate) => existing.has(candidate),
    ),
    "/Applications/Openbase.app/Contents/Resources/OpenbaseNetmesh.app",
  );
});

test("an unpackaged run resolves the checkout relative to the Electron sources", () => {
  const existing = new Set([
    "/workspace/netmesh-macos/DerivedData/Build/Products/Debug/OpenbaseNetmesh.app",
  ]);
  assert.equal(
    findMenuBarApp(
      {
        electronDir: "/workspace/desktop/electron",
        envPath: undefined,
        resourcesPath: undefined,
        workspacePath: undefined,
      },
      (candidate) => existing.has(candidate),
    ),
    "/workspace/netmesh-macos/DerivedData/Build/Products/Debug/OpenbaseNetmesh.app",
  );
});

test("the env override beats every other candidate", () => {
  const options = { ...packagedDevOptions, envPath: "/custom/OpenbaseNetmesh.app" };
  assert.equal(menuBarAppCandidates(options)[0], "/custom/OpenbaseNetmesh.app");
  assert.equal(
    findMenuBarApp(options, () => true),
    "/custom/OpenbaseNetmesh.app",
  );
});

test("no candidate on disk resolves to null, never a throw", () => {
  assert.equal(findMenuBarApp(packagedDevOptions, () => false), null);
});
