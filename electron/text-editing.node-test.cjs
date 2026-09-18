const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { registerTextEditing } = require("./text-editing.cjs");

function setup(platform = "darwin") {
  const webContents = new EventEmitter();
  const calls = [];
  for (const action of ["copy", "cut", "paste", "selectAll"]) {
    webContents[action] = () => calls.push(action);
  }
  const window = { webContents };
  let menu;
  let popup;
  registerTextEditing(window, {
    buildFromTemplate(items) {
      menu = items;
      return { popup: (options) => { popup = options; } };
    },
  }, platform);
  return { window, calls, menu: () => menu, popup: () => popup };
}

for (const platform of ["darwin", "win32", "linux"]) {
  test(`${platform}: copy shortcuts reach Chromium without consuming other keys`, () => {
    const { window, calls } = setup(platform);
    let prevented = 0;
    const event = { preventDefault: () => prevented++ };
    const copy = { type: "keyDown", key: "C", meta: platform === "darwin", control: platform !== "darwin" };
    window.webContents.emit("before-input-event", event, copy);
    assert.deepEqual(calls, ["copy"]);
    assert.equal(prevented, 1);
    for (const input of [
      { ...copy, type: "keyUp" },
      { ...copy, shift: true },
      { ...copy, alt: true },
      { ...copy, meta: true, control: true },
      { ...copy, meta: false, control: false },
      { ...copy, key: "w" },
      { ...copy, key: "v" },
    ]) window.webContents.emit("before-input-event", event, input);
    assert.deepEqual(calls, ["copy"]);
    assert.equal(prevented, 1);
  });
}

test("selected report or thread text gets a Copy menu targeting its window", () => {
  const state = setup();
  state.window.webContents.emit("context-menu", {}, {
    isEditable: false, selectionText: "Selected text", editFlags: { canCopy: true },
  });
  assert.deepEqual(state.menu().map(({ label, enabled }) => ({ label, enabled })), [{ label: "Copy", enabled: true }]);
  assert.deepEqual(state.popup(), { window: state.window });
  state.menu()[0].click();
  assert.deepEqual(state.calls, ["copy"]);
});

test("editable fields retain cut, copy, paste and select-all with edit permissions", () => {
  const state = setup();
  state.window.webContents.emit("context-menu", {}, {
    isEditable: true, selectionText: "", editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
  });
  assert.deepEqual(state.menu().map(({ label, enabled, type }) => ({ label, enabled, type })), [
    { label: "Cut", enabled: false, type: undefined },
    { label: "Copy", enabled: false, type: undefined },
    { label: "Paste", enabled: true, type: undefined },
    { label: undefined, enabled: undefined, type: "separator" },
    { label: "Select All", enabled: true, type: undefined },
  ]);
  state.menu()[2].click();
  state.menu()[4].click();
  assert.deepEqual(state.calls, ["paste", "selectAll"]);
});

test("unselected non-editable content does not open an empty context menu", () => {
  const state = setup();
  state.window.webContents.emit("context-menu", {}, { isEditable: false, selectionText: "", editFlags: {} });
  assert.equal(state.menu(), undefined);
  assert.equal(state.popup(), undefined);
});
