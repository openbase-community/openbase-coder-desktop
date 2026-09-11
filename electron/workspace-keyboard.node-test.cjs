const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { registerWorkspaceKeyboard } = require("./workspace-keyboard.cjs");

for (const platform of ["darwin", "win32", "linux"]) {
  test(`${platform}: route close-tab to the renderer, leaving other menu shortcuts intact`, () => {
    const contents = new EventEmitter();
    let url = "file:///app/index.html#/dashboard/reports?report=example.md";
    let ignored;
    contents.getURL = () => url;
    contents.setIgnoreMenuShortcuts = (value) => { ignored = value; };
    registerWorkspaceKeyboard(contents, platform);
    const close = { key: "w", meta: platform === "darwin", control: platform !== "darwin" };
    const key = (input) => contents.emit("before-input-event", {}, input);
    key(close);
    assert.equal(ignored, true);
    key({ ...close, key: "q" });
    assert.equal(ignored, false);
    key({ ...close, shift: true });
    assert.equal(ignored, false);
    key({ ...close, alt: true });
    assert.equal(ignored, false);
    key({ key: "w" });
    assert.equal(ignored, false);
    key(close);
    contents.emit("blur");
    assert.equal(ignored, false);
    for (const other of ["", "file:///app/index.html#/onboarding", "file:///app/index.html#/dashboard-other"]) {
      url = other;
      key(close);
      assert.equal(ignored, false);
    }
  });
}
