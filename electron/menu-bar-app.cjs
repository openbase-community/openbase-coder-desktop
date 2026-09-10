const path = require("node:path");

// Resolution for the Swift status menu-bar UI (OpenbaseNetmesh.app). The menu
// bar must run whenever the desktop app runs, on every install pathway:
//  - developer install: the freshest build products inside the workspace's
//    netmesh-macos checkout (found via installation.json for packaged dev
//    builds, or relative to the Electron sources for unpackaged runs);
//  - standalone (DMG) install: the copy bundled into Contents/Resources;
//  - either: an explicit env override.
function menuBarAppCandidates({ electronDir, envPath, resourcesPath, workspacePath }) {
  const workspaceRoots = [];
  if (workspacePath) workspaceRoots.push(workspacePath);
  // Unpackaged runs from a checkout have no installation.json; the workspace
  // root is two levels above desktop/electron. Inside a packaged app this
  // resolves into the asar and simply never exists on disk.
  if (electronDir) workspaceRoots.push(path.join(electronDir, "..", ".."));
  const workspaceCandidates = workspaceRoots.flatMap((workspaceRoot) =>
    ["Release", "Debug"].map((configuration) =>
      path.join(
        workspaceRoot,
        "netmesh-macos",
        "DerivedData",
        "Build",
        "Products",
        configuration,
        "OpenbaseNetmesh.app",
      ),
    ),
  );
  return [
    envPath,
    ...workspaceCandidates,
    resourcesPath ? path.join(resourcesPath, "OpenbaseNetmesh.app") : null,
  ].filter(Boolean);
}

function findMenuBarApp(options, exists) {
  return menuBarAppCandidates(options).find((candidate) => exists(candidate)) ?? null;
}

module.exports = { findMenuBarApp, menuBarAppCandidates };
