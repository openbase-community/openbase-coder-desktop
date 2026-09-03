// Render assets/dmg/background.html to Retina DMG background assets using the
// devDependency Electron itself (no extra image tooling): a 1x PNG, a 2x PNG,
// and a combined HiDPI TIFF that Finder picks the right resolution from.
//
// Run via the Electron binary, not node:
//   electron scripts/generate-dmg-background.mjs
// build-dmg.mjs does this automatically.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const htmlPath = path.join(repoRoot, "assets", "dmg", "background.html");
const outDir = path.join(repoRoot, "release", "dmg-resources");

const WIDTH = 660;
const HEIGHT = 400;

function settle(webContents) {
  // requestAnimationFrame never fires in a hidden window, so give the
  // compositor a fixed beat after load/zoom instead.
  return webContents.executeJavaScript(
    "new Promise((resolve) => setTimeout(() => resolve(true), 400))",
  );
}

async function main() {
  // Keep the build silent: no dock icon for the offscreen render.
  app.dock?.hide();

  // Render the 660x400 layout at 2x zoom in a doubled window so the capture
  // is Retina-quality no matter what display (if any) the build machine has.
  // The window is overscanned a little because the compositor leaves a dirty
  // band on the bottom edge of a hidden window; the crop below discards it.
  const overscan = 24;
  const win = new BrowserWindow({
    show: false,
    width: WIDTH * 2,
    height: HEIGHT * 2 + overscan,
    useContentSize: true,
    frame: false,
    resizable: false,
    webPreferences: { backgroundThrottling: false },
  });

  await win.loadFile(htmlPath);
  win.webContents.setZoomFactor(2);
  await settle(win.webContents);

  const captured = await win.webContents.capturePage();
  // capturePage returns display-scale-dependent pixels; crop the page region
  // scale-aware, then resize to the exact 2x/1x output dimensions.
  const capturedSize = captured.getSize();
  const scaleX = capturedSize.width / (WIDTH * 2);
  const scaleY = capturedSize.height / (HEIGHT * 2 + overscan);
  const page = captured.crop({
    height: Math.round(HEIGHT * 2 * scaleY),
    width: Math.round(WIDTH * 2 * scaleX),
    x: 0,
    y: 0,
  });
  const png2x = page.resize({ width: WIDTH * 2, height: HEIGHT * 2, quality: "best" });
  const png1x = page.resize({ width: WIDTH, height: HEIGHT, quality: "best" });

  mkdirSync(outDir, { recursive: true });
  const path1x = path.join(outDir, "background.png");
  const path2x = path.join(outDir, "background@2x.png");
  const tiffPath = path.join(outDir, "background.tiff");
  writeFileSync(path1x, png1x.toPNG());
  writeFileSync(path2x, png2x.toPNG());

  // Combine into a HiDPI TIFF; -cathidpicheck verifies the 1x/2x pairing.
  execFileSync("tiffutil", ["-cathidpicheck", path1x, path2x, "-out", tiffPath], {
    stdio: "inherit",
  });

  console.log(`Generated ${tiffPath}`);
}

// With an ESM entry point Electron only emits "ready" after this module
// finishes evaluating, so a top-level `await app.whenReady()` deadlocks.
// Chain instead of awaiting.
app
  .whenReady()
  .then(main)
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error);
      app.exit(1);
    },
  );
