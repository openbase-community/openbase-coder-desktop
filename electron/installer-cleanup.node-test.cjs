const assert = require("node:assert/strict");
const test = require("node:test");
const { cleanupResultMessage } = require("./installer-cleanup.cjs");

test("reports complete installer cleanup only when every action succeeds", () => {
  assert.equal(
    cleanupResultMessage({ ejected: 1, failures: [], trashed: 1 }),
    "Installer cleaned up",
  );
});

test("reports partial installer cleanup when an action fails after progress", () => {
  assert.equal(
    cleanupResultMessage({
      ejected: 1,
      failures: ["Could not move Openbase.dmg to the Trash"],
      trashed: 0,
    }),
    "Installer partially cleaned up",
  );
});

test("reports incomplete installer cleanup when no action succeeds", () => {
  assert.equal(
    cleanupResultMessage({
      ejected: 0,
      failures: ["Could not eject Openbase"],
      trashed: 0,
    }),
    "Installer cleanup incomplete",
  );
});
