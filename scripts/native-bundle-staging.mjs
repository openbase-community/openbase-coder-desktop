import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Node's rename cannot replace a populated directory. Darwin's RENAME_SWAP
// exchanges both directory entries in one operation, with no missing-live gap.
// Compile only in the disposable staging directory; failure leaves live intact.
export function publishNativeBundle(incoming, destination, temporary) {
  if (process.platform !== "darwin") throw new Error("Native bundle staging requires macOS.");
  const helper = path.join(temporary, "bundle-swap");
  execFileSync("xcrun", ["clang", "-Wall", "-Wextra", "-Werror",
    fileURLToPath(new URL("./native-bundle-swap.c", import.meta.url)), "-o", helper], { stdio: "inherit" });
  execFileSync(helper, [incoming, destination], { stdio: "inherit" });
}

export function stageNativeBundle(destination, prepare) {
  mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = mkdtempSync(path.join(path.dirname(destination), ".native-stage-"));
  const incoming = path.join(temporary, path.basename(destination));
  let publicationAttempted = false;
  try {
    prepare(incoming, temporary);
    if (!existsSync(incoming)) throw new Error(`Prepared bundle missing: ${path.basename(destination)}`);
    execFileSync("codesign", ["--verify", "--strict", "--deep", incoming], { stdio: "inherit" });
    publicationAttempted = true;
    publishNativeBundle(incoming, destination, temporary);
  } finally {
    // After a swap, incoming holds the OLD sealed bundle. Keep its files intact;
    // never delete code that may still back a running helper or menu-bar process.
    // A child failure can occur after the syscall; retain evidence in that case too.
    if (publicationAttempted && existsSync(incoming)) {
      console.log(`[stage-netmesh] retained bundle at ${incoming}`);
    } else {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}

export function downloadNativeBundle(destination, url, zipName, validate) {
  return stageNativeBundle(destination, (incoming, temporary) => {
    const zip = path.join(temporary, zipName);
    console.log(`[stage-netmesh] downloading prebuilt from ${url}`);
    execFileSync("curl", ["-fL", "--retry", "3", "-o", zip, url], { stdio: "inherit" });
    // ditto preserves signatures and extended attributes. Extract away from live.
    execFileSync("ditto", ["-x", "-k", zip, temporary], { stdio: "inherit" });
    rmSync(zip);
    validate(incoming);
  });
}
