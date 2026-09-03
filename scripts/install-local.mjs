// Copy the locally built app into /Applications for packaged testing.
// Built with openbaseDevBuild=true, so it never self-updates from the
// production feed (see the workspace AUTO_UPDATE.md). No bundled CLI seed or
// companion app — dev machines use the PATH-installed CLI.
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

const appName = "Openbase.app";
const built = path.resolve("release", "mac-arm64", appName);
const target = path.join("/Applications", appName);

if (!existsSync(built)) {
  console.error(`Built app not found at ${built}; run the build first.`);
  process.exit(1);
}
if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true });
}
cpSync(built, target, { recursive: true, verbatimSymlinks: true });
console.log(`Installed ${target} (dev build; auto-update disabled)`);
