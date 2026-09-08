const assert = require("node:assert/strict");
const test = require("node:test");
const { completeHelperReplacement } = require("./netmesh-registration.cjs");
const pending = { ok: true, helper: "notRegistered", helperReplacementPending: true };

test("pending registration continues through a new request", async () => {
  let calls = 0;
  const enabled = { ok: true, helper: "enabled", helperReplaced: true };
  const status = await completeHelperReplacement(
    async () => (++calls === 1 ? pending : enabled),
    async () => ({ ok: true, helper: "enabled" }), async () => {},
  );
  assert.deepEqual(status, enabled);
  assert.equal(calls, 2);
});

test("pending registration is bounded", async () => {
  let calls = 0;
  await assert.rejects(completeHelperReplacement(
    async () => pending,
    async () => { calls += 1; return pending; }, async () => {},
  ), /did not complete/);
  assert.equal(calls, 10);
});

test("approval requirements and failures are never retried", async () => {
  let calls = 0;
  await assert.rejects(completeHelperReplacement(async () => {
    calls += 1;
    return { ...pending, helper: "requiresApproval" };
  }), /cannot continue/);
  assert.equal(calls, 1);
  const failure = { ok: false, error: "registration failed" };
  assert.equal(await completeHelperReplacement(async () => failure), failure);
});

test("approval during continuation stops registration", async () => {
  let registrations = 0;
  await assert.rejects(completeHelperReplacement(
    async () => pending,
    async () => { registrations += 1; return { ok: true, helper: "requiresApproval" }; },
    async () => {},
  ), /requiresApproval/);
  assert.equal(registrations, 1);
});

test("successful registration still requires version verification", async () => {
  let calls = 0;
  const failure = { ok: false, error: "wrong helper version" };
  assert.equal(await completeHelperReplacement(
    async () => (++calls === 1 ? pending : failure),
    async () => ({ ok: true, helper: "enabled" }), async () => {},
  ), failure);
  assert.equal(calls, 2);
});
