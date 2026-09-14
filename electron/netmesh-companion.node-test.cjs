const assert = require("node:assert/strict");
const test = require("node:test");

const { companionProcessPattern } = require("./netmesh-companion.cjs");

test("companion cleanup targets only the listener owned by this manager", () => {
  const pattern = new RegExp(companionProcessPattern(47154));

  assert.match(
    "/Applications/OpenbaseNetmeshCompanion --openbase-ipc-port 47154 --openbase-ipc-secret one",
    pattern,
  );
  assert.doesNotMatch(
    "/Applications/OpenbaseNetmeshCompanion --openbase-ipc-port 57401 --openbase-ipc-secret two",
    pattern,
  );
});
