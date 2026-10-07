const fsp = require("node:fs/promises");
const path = require("node:path");

async function copyPackage(sourceRoot, targetRoot) {
  const tempRoot = `${targetRoot}.staging-${process.pid}-${Date.now()}`;
  await fsp.rm(tempRoot, { force: true, recursive: true });
  await fsp.mkdir(path.dirname(targetRoot), { recursive: true });
  await fsp.cp(sourceRoot, tempRoot, {
    dereference: false,
    preserveTimestamps: true,
    recursive: true,
    // The activated runtime must survive replacement/removal of the app seed.
    // Without this, Node rewrites relative links to absolute source paths.
    verbatimSymlinks: true,
  });
  const suffix = process.platform === "win32" ? ".exe" : "";
  await fsp.chmod(path.join(tempRoot, "bin", `openbase-coder${suffix}`), 0o755);
  const livekitPath = path.join(tempRoot, "bin", `livekit-server${suffix}`);
  if (await fsp.stat(livekitPath).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  })) {
    await fsp.chmod(livekitPath, 0o755);
  }
  await fsp.rm(targetRoot, { force: true, recursive: true });
  await fsp.rename(tempRoot, targetRoot);
}

module.exports = { copyPackage };
