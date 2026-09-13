const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const contractUrl = pathToFileURL(
  path.resolve(__dirname, "../scripts/netmesh-prebuilt-contract.mjs"),
).href;

test("Netmesh prebuilt contract rejects stale and malformed builds", async () => {
  const { MINIMUM_NETMESH_BUILD, assertSupportedNetmeshBuild } = await import(contractUrl);

  assert.equal(assertSupportedNetmeshBuild(` ${MINIMUM_NETMESH_BUILD}\n`, "companion"), 16);
  assert.throws(
    () => assertSupportedNetmeshBuild(String(MINIMUM_NETMESH_BUILD - 1), "companion"),
    /too old/,
  );
  assert.throws(() => assertSupportedNetmeshBuild("latest", "companion"), /invalid/);
});

test("Netmesh prebuilts follow the package release channel", async () => {
  const { resolveNetmeshPrebuiltPrefix } = await import(contractUrl);

  assert.equal(resolveNetmeshPrebuiltPrefix("0.1.18"), "mac");
  assert.equal(
    resolveNetmeshPrebuiltPrefix("0.1.18-staging.20260913171839"),
    "mac-staging",
  );
  assert.equal(
    resolveNetmeshPrebuiltPrefix("0.1.18-staging.20260913171839", "test-prefix"),
    "test-prefix",
  );
});
