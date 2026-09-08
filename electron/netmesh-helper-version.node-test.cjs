const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");

test("Netmesh helper protocol upgrades receive a new SMAppService build", (t) => {
  const netmeshRoot = path.resolve(repoRoot, "..", "netmesh-macos");
  if (!existsSync(netmeshRoot)) {
    t.skip("Private companion sources are absent from public desktop checkouts");
    return;
  }
  const project = readFileSync(path.join(netmeshRoot, "project.yml"), "utf8");
  const protocol = readFileSync(
    path.join(netmeshRoot, "Shared/NetmeshDaemonProtocol.swift"),
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

  assert.match(manager, /register: \(\) => completeHelperReplacement\(\s*\(\) => call\("POST", "\/replace-helper"\),\s*\(\) => call\("POST", "\/register"\)/);
  assert.doesNotMatch(manager, /register: \(\) => call\("POST", "\/register"\)/);
});
