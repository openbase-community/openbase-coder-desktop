function registerAppearance({ ipcMain, nativeTheme, BrowserWindow }) {
  ipcMain.on("openbase:appearance:set", (event, theme) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return;
    if (event.senderFrame !== event.sender.mainFrame) return;
    if (!["light", "dark", "system"].includes(theme)) return;
    nativeTheme.themeSource = theme;
  });
}

module.exports = { registerAppearance };
