const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const contractUrl = pathToFileURL(
  path.resolve(__dirname, "../scripts/netmesh-prebuilt-contract.mjs"),
).href;

test("Netmesh prebuilt contract rejects stale and malformed builds", async () => {
  const { MINIMUM_NETMESH_BUILD, assertSupportedNetmeshBuild } = await import(contractUrl);

  assert.equal(assertSupportedNetmeshBuild(` ${MINIMUM_NETMESH_BUILD}\n`, "companion"), 15);
  assert.throws(
    () => assertSupportedNetmeshBuild(String(MINIMUM_NETMESH_BUILD - 1), "companion"),
    /too old/,
  );
  assert.throws(() => assertSupportedNetmeshBuild("latest", "companion"), /invalid/);
});
