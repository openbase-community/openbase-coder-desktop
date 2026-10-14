const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { handleControlRequest } = require("./desktop-control-server.cjs");

for (const authorized of [false, true]) {
  test(`menu-bar quit ${authorized ? "flushes before quitting" : "requires authentication"}`, async () => {
    let quit = false;
    const response = new EventEmitter();
    response.writeHead = (status) => { response.status = status; };
    response.end = () => {};
    await handleControlRequest({
      request: { method: "POST", url: "/quit", headers: { "x-openbase-desktop-secret": authorized ? "test-secret" : "wrong" } },
      response,
      secret: "test-secret",
      onQuitRequest: () => { quit = true; },
    });
    assert.equal(response.status, authorized ? 200 : 401);
    assert.equal(quit, false);
    response.emit("finish");
    assert.equal(quit, authorized);
  });
}
