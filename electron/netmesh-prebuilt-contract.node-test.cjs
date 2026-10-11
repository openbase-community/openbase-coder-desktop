const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const contractUrl = pathToFileURL(
  path.resolve(__dirname, "../scripts/netmesh-prebuilt-contract.mjs"),
).href;

test("Netmesh prebuilt contract rejects stale and malformed builds", async () => {
  const { MINIMUM_NETMESH_BUILD, assertSupportedNetmeshBuild } = await import(contractUrl);

  assert.equal(
    assertSupportedNetmeshBuild(` ${MINIMUM_NETMESH_BUILD}\n`, "companion"),
    MINIMUM_NETMESH_BUILD,
  );
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
  assert.equal(
    resolveNetmeshPrebuiltPrefix(
      "0.1.18",
      undefined,
      "https://app-staging.openbase.cloud/",
    ),
    "mac-staging",
  );
  assert.equal(
    resolveNetmeshPrebuiltPrefix("0.1.18", undefined, "https://app.openbase.cloud"),
    "mac",
  );
  assert.equal(
    resolveNetmeshPrebuiltPrefix("0.1.18", "test-prefix", "https://app-staging.openbase.cloud"),
    "test-prefix",
  );
});

test("staging installs resolve their cloud from ~/.openbase/.env", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { configuredWebBackendUrl, resolveNetmeshPrebuiltPrefix } = await import(contractUrl);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "netmesh-env-"));
  const envFile = path.join(dir, ".env");
  fs.writeFileSync(envFile, 'OTHER=1\nOPENBASE_CODER_CLI_WEB_BACKEND_URL="https://app-staging.openbase.cloud"\n');
  const url = configuredWebBackendUrl({}, envFile);
  assert.equal(url, "https://app-staging.openbase.cloud");
  assert.equal(resolveNetmeshPrebuiltPrefix("0.1.18", undefined, url), "mac-staging");
  assert.equal(
    configuredWebBackendUrl({ OPENBASE_CODER_CLI_WEB_BACKEND_URL: "https://x.test" }, envFile),
    "https://x.test",
  );
  assert.equal(configuredWebBackendUrl({}, path.join(dir, "missing")), undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});
