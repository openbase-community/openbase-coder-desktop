const assert = require("node:assert/strict");
const { test } = require("node:test");
const { registerAppearance } = require("./appearance.cjs");

test("appearance IPC accepts supported modes only from the window's main frame", () => {
  let onTheme;
  const mainFrame = {};
  const sender = { mainFrame };
  const nativeTheme = { themeSource: "system" };
  registerAppearance({
    ipcMain: { on(channel, handler) {
      assert.equal(channel, "openbase:appearance:set");
      onTheme = handler;
    } },
    nativeTheme,
    BrowserWindow: { fromWebContents: (contents) => contents === sender },
  });
  const event = { sender, senderFrame: mainFrame };
  for (const theme of ["dark", "light", "system"]) {
    onTheme(event, theme);
    assert.equal(nativeTheme.themeSource, theme);
  }
  for (const theme of [null, {}, "invalid", 1]) onTheme(event, theme);
  onTheme({ sender, senderFrame: {} }, "dark");
  onTheme({ sender: { mainFrame }, senderFrame: mainFrame }, "dark");
  assert.equal(nativeTheme.themeSource, "system");
});
