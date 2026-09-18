const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

function captureDesktopProvenance({ appPackaged, nonDeveloperInstall, desktopDir }) {
  if (nonDeveloperInstall) return null;
  try {
    if (!appPackaged) {
      const { capture } = require(path.join(desktopDir, "../coder-react/build/runtime-provenance.cjs"));
      return capture(path.dirname(desktopDir), "desktop-main");
    }
    // The stamp belongs to this build, never to the checkout at launch time.
    const stamp = JSON.parse(fs.readFileSync(path.join(desktopDir, "dist/desktop-main-provenance.json"), "utf8"));
    if (stamp.schema_version !== 1 || !stamp.files) return null;
    const names = fs.readdirSync(path.join(desktopDir, "electron")).filter((name) => /\.(cjs|json)$/.test(name)).sort();
    if (JSON.stringify(names) !== JSON.stringify(Object.keys(stamp.files).sort())) return null;
    for (const name of names) {
      const actual = createHash("sha256").update(fs.readFileSync(path.join(desktopDir, "electron", name))).digest("hex");
      if (stamp.files[name] !== actual) return null;
    }
    const { files, ...publicStamp } = stamp;
    return publicStamp;
  } catch {
    return null; // Legacy/missing stamps explicitly surface as unverified.
  }
}

module.exports = { captureDesktopProvenance };
