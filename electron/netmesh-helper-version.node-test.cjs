const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");

test("Netmesh helper protocol upgrades receive a new SMAppService build", () => {
  const project = readFileSync(path.join(repoRoot, "netmesh-macos/project.yml"), "utf8");
  const protocol = readFileSync(
    path.join(repoRoot, "netmesh-macos/Shared/NetmeshDaemonProtocol.swift"),
    "utf8",
  );
  const buildMatch = project.match(/^\s*CURRENT_PROJECT_VERSION:\s*"(\d+)"/m);
  const versionMatch = protocol.match(/netmesh-helper 0\.(\d+) \(tailscaled/);

  assert.ok(buildMatch, "project.yml must define a numeric companion/helper build");
  assert.ok(versionMatch, "the helper must report its 0.x protocol version");
  assert.equal(
    Number(buildMatch[1]),
    Number(versionMatch[1]),
    "bump CURRENT_PROJECT_VERSION with the helper protocol for diagnosable release metadata",
  );
});

test("desktop registration uses the fail-closed helper replacement endpoint", () => {
  const manager = readFileSync(path.join(repoRoot, "electron/netmesh-companion.cjs"), "utf8");

  assert.match(manager, /register: \(\) => call\("POST", "\/replace-helper"\)/);
  assert.doesNotMatch(manager, /register: \(\) => call\("POST", "\/register"\)/);
});
