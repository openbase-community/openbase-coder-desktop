const assert = require("node:assert/strict");
const test = require("node:test");
const { createSingleFlight } = require("./single-flight.cjs");

test("coalesces concurrent calls and allows a later run", async () => {
  let calls = 0;
  let release;
  const run = createSingleFlight(async () => {
    calls += 1;
    await new Promise((resolve) => {
      release = resolve;
    });
    return calls;
  });

  const first = run();
  const concurrent = run();
  assert.equal(first, concurrent);
  await Promise.resolve();
  assert.equal(calls, 1);

  release();
  assert.equal(await first, 1);
  assert.equal(await concurrent, 1);

  const later = run();
  await Promise.resolve();
  release();
  assert.equal(await later, 2);
});

test("allows retry after a failed run", async () => {
  let calls = 0;
  const run = createSingleFlight(async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error("first run failed");
    }
    return "recovered";
  });

  await assert.rejects(run(), /first run failed/);
  assert.equal(await run(), "recovered");
  assert.equal(calls, 2);
});
