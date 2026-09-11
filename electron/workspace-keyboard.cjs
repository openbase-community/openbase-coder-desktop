function registerWorkspaceKeyboard(webContents, platform = process.platform) {
  // Let the renderer close tabs and confirm drafts before Electron's Close Window accelerator.
  webContents.on("before-input-event", (_event, input) => {
    const url = webContents.getURL();
    const inWorkspace = URL.canParse(url) && /^#\/dashboard(?:[/?]|$)/.test(new URL(url).hash);
    const primary = platform === "darwin"
      ? input.meta && !input.control
      : input.control && !input.meta;
    webContents.setIgnoreMenuShortcuts(Boolean(
      inWorkspace && primary && !input.alt && !input.shift && input.key.toLowerCase() === "w",
    ));
  });
  webContents.on("blur", () => webContents.setIgnoreMenuShortcuts(false));
}

module.exports = { registerWorkspaceKeyboard };
