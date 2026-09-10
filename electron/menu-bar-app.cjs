const path = require("node:path");

const EXPECTED_CODESIGN_IDENTIFIER = "cloud.openbase.netmesh";
const EXPECTED_TEAM_IDENTIFIER = "E6GA9X89TN";

// Resolution for the Swift status menu-bar UI (OpenbaseNetmesh.app). The menu
// bar must run whenever the desktop app runs, on every install pathway:
//  - developer install: the signed staged app in desktop/companion-build first,
//    then raw build products inside the workspace's netmesh-macos checkout;
//  - standalone (DMG) install: the copy bundled into Contents/Resources;
//  - either: an explicit env override.
function menuBarAppCandidates({ electronDir, envPath, resourcesPath, workspacePath }) {
  const workspaceRoots = [];
  if (workspacePath) workspaceRoots.push(workspacePath);
  // Unpackaged runs from a checkout have no installation.json; the workspace
  // root is two levels above desktop/electron. Inside a packaged app this
  // resolves into the asar and simply never exists on disk.
  if (electronDir) workspaceRoots.push(path.join(electronDir, "..", ".."));
  const stagedCandidates = workspaceRoots.map((workspaceRoot) =>
    path.join(workspaceRoot, "desktop", "companion-build", "OpenbaseNetmesh.app"),
  );
  const rawBuildCandidates = workspaceRoots.flatMap((workspaceRoot) =>
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
    ...stagedCandidates,
    resourcesPath ? path.join(resourcesPath, "OpenbaseNetmesh.app") : null,
    ...rawBuildCandidates,
  ].filter(Boolean);
}

function findMenuBarApp(options, exists, isUsable = () => true) {
  return menuBarAppCandidates(options).find((candidate) => exists(candidate) && isUsable(candidate)) ?? null;
}

function isExpectedCodeSignatureOutput(output) {
  return (
    output.includes(`Identifier=${EXPECTED_CODESIGN_IDENTIFIER}`) &&
    output.includes(`TeamIdentifier=${EXPECTED_TEAM_IDENTIFIER}`)
  );
}

module.exports = {
  EXPECTED_CODESIGN_IDENTIFIER,
  EXPECTED_TEAM_IDENTIFIER,
  findMenuBarApp,
  isExpectedCodeSignatureOutput,
  menuBarAppCandidates,
};
