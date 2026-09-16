function registerTextEditing(window, Menu, platform = process.platform) {
  const contents = window.webContents;
  // Route Copy to Chromium directly rather than macOS's native responder chain.
  contents.on("before-input-event", (event, input) => {
    const primary = platform === "darwin"
      ? input.meta && !input.control
      : input.control && !input.meta;
    if (input.type === "keyDown" && primary && !input.alt && !input.shift && input.key.toLowerCase() === "c") {
      event.preventDefault();
      contents.copy();
    }
  });

  contents.on("context-menu", (_event, params) => {
    const items = [];
    if (params.isEditable) {
      items.push({ label: "Cut", enabled: params.editFlags.canCut, click: () => contents.cut() });
    }
    if (params.isEditable || params.selectionText) {
      items.push({ label: "Copy", enabled: params.editFlags.canCopy, click: () => contents.copy() });
    }
    if (params.isEditable) {
      items.push({ label: "Paste", enabled: params.editFlags.canPaste, click: () => contents.paste() });
      items.push({ type: "separator" });
      items.push({ label: "Select All", enabled: params.editFlags.canSelectAll, click: () => contents.selectAll() });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window });
  });
}

module.exports = { registerTextEditing };
