import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const assetsDir = path.join(repoRoot, "assets");
const sourceMark = path.join(assetsDir, "openbase-coder-mark.svg");
const outputPng = path.join(assetsDir, "openbase-coder-icon.png");
const iconsetDir = path.join(assetsDir, "icon.iconset");
const outputIcns = path.join(assetsDir, "openbase-coder-icon.icns");

const canvasSize = 1024;
const tileSize = 824;
const tileRadius = 180;
const markSize = 450;

// Staging builds get an amber tile so a staging install is unmistakable in
// the Dock (the app identity is otherwise the same as production).
const isStaging = process.env.OPENBASE_DESKTOP_ICON_VARIANT === "staging";
const tileFill = isStaging ? "#f6a821" : "#ffffff";
const tileStroke = isStaging ? "#c77f00" : "#d8dde6";

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

function requireCommand(command) {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
  } catch {
    throw new Error(`Missing required command: ${command}`);
  }
}

requireCommand("magick");
requireCommand("iconutil");

const tmp = mkdtempSync(path.join(tmpdir(), "openbase-coder-icons-"));
const markPath = path.join(tmp, "mark.png");
const tilePath = path.join(tmp, "tile.png");

try {
  await mkdir(iconsetDir, { recursive: true });

  run("magick", [
    "-background",
    "none",
    sourceMark,
    "-resize",
    `${markSize}x${markSize}`,
    markPath,
  ]);

  run("magick", [
    "-size",
    `${tileSize}x${tileSize}`,
    "xc:none",
    "-fill",
    tileFill,
    "-stroke",
    tileStroke,
    "-strokewidth",
    "6",
    "-draw",
    `roundrectangle 3,3 ${tileSize - 4},${tileSize - 4} ${tileRadius},${tileRadius}`,
    tilePath,
  ]);

  run("magick", [
    "-size",
    `${canvasSize}x${canvasSize}`,
    "xc:none",
    tilePath,
    "-gravity",
    "center",
    "-composite",
    markPath,
    "-gravity",
    "center",
    "-composite",
    "-strip",
    "PNG32:" + outputPng,
  ]);

  const iconSizes = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_64x64.png", 64],
    ["icon_64x64@2x.png", 128],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];

  for (const [fileName, size] of iconSizes) {
    run("magick", [
      outputPng,
      "-resize",
      `${size}x${size}`,
      "-strip",
      "PNG32:" + path.join(iconsetDir, fileName),
    ]);
  }

  run("iconutil", ["-c", "icns", "-o", outputIcns, iconsetDir]);
} finally {
  rmSync(tmp, { force: true, recursive: true });
}
