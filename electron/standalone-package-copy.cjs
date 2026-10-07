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

async function repairSeedSymlinks(packageRoot, seedRoot) {
  const root = await fsp.realpath(packageRoot);
  const source = path.resolve(seedRoot);
  const directories = [root];
  let repaired = 0;
  while (directories.length) {
    const directory = directories.pop();
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(entryPath);
      } else if (entry.isSymbolicLink()) {
        const link = await fsp.readlink(entryPath);
        if (!path.isAbsolute(link)) continue;
        const relative = path.relative(source, link);
        if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          continue;
        }
        // Repair only links into this app's seed, using the installed release's
        // own files. Never copy the newer seed over an existing CLI version.
        const destination = path.join(root, relative);
        await fsp.lstat(destination);
        const replacement = `${entryPath}.repair-${process.pid}`;
        await fsp.symlink(path.relative(directory, destination), replacement);
        try {
          await fsp.rename(replacement, entryPath);
        } finally {
          await fsp.rm(replacement, { force: true });
        }
        repaired += 1;
      }
    }
  }
  return repaired;
}

module.exports = { copyPackage, repairSeedSymlinks };
