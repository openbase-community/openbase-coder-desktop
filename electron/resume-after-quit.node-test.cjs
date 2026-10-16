const test = require("node:test");
const assert = require("node:assert/strict");
const { waitForBackendAfterQuit } = require("./resume-after-quit.cjs");

test("reopening waits through connection refusal and unhealthy startup", async () => {
  let requests = 0;
  let waits = 0;
  const ready = await waitForBackendAfterQuit({
    backendBaseUrl: "http://127.0.0.1:8123",
    fetchImpl: async (url) => {
      assert.equal(url.href, "http://127.0.0.1:8123/api/health/");
      requests += 1;
      if (requests === 1) throw new Error("ECONNREFUSED");
      return { ok: requests === 3 };
    },
    delay: async () => { waits += 1; },
  });
  assert.equal(ready, true);
  assert.equal(waits, 2);
});

test("failed recovery is bounded", async () => {
  let requests = 0;
  assert.equal(await waitForBackendAfterQuit({
    backendBaseUrl: "http://127.0.0.1:7999", attempts: 3,
    fetchImpl: async () => { requests += 1; return { ok: false }; },
    delay: async () => {},
  }), false);
  assert.equal(requests, 3);
});

test("closing the window cancels recovery without fetching", async () => {
  assert.equal(await waitForBackendAfterQuit({
    backendBaseUrl: "http://127.0.0.1:7999", isCancelled: () => true,
    fetchImpl: () => assert.fail("must not fetch"),
  }), false);
});
