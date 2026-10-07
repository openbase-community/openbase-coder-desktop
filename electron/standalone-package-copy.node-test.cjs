const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { copyPackage, repairSeedSymlinks } = require("./standalone-package-copy.cjs");

test("activated runtime stays independent when the desktop seed is replaced", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "standalone-copy-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const seed = path.join(root, "app", "seed");
  const target = path.join(root, "releases", "old");
  const suffix = process.platform === "win32" ? ".exe" : "";
  await fsp.mkdir(path.join(seed, "bin"), { recursive: true });
  await fsp.mkdir(path.join(seed, "python", "bin"), { recursive: true });
  await fsp.writeFile(path.join(seed, "bin", `openbase-coder${suffix}`), "launcher");
  await fsp.writeFile(path.join(seed, "python", "bin", "python3.12"), "old runtime");
  await fsp.symlink("python3.12", path.join(seed, "python", "bin", "python3"));
  await fsp.symlink("python3", path.join(seed, "python", "bin", "python"));
  await copyPackage(seed, target);

  const activatedPython = path.join(target, "python", "bin", "python");
  await fsp.writeFile(path.join(seed, "python", "bin", "python3.12"), "new runtime");
  assert.equal(await fsp.readFile(activatedPython, "utf8"), "old runtime");
  assert.equal(await fsp.readlink(activatedPython), "python3");
  await fsp.rm(seed, { recursive: true });
  assert.equal(await fsp.readFile(activatedPython, "utf8"), "old runtime");
  assert.equal((await fsp.stat(path.join(target, "bin", `openbase-coder${suffix}`))).mode & 0o777, 0o755);
});

test("repairs legacy seed links using the installed version without following other links", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "standalone-repair-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const seed = path.join(root, "app", "seed");
  const installed = path.join(root, "release");
  await fsp.mkdir(path.join(seed, "python", "bin"), { recursive: true });
  await fsp.mkdir(path.join(installed, "python", "bin"), { recursive: true });
  await fsp.writeFile(path.join(seed, "python", "bin", "python3.12"), "new runtime");
  await fsp.writeFile(path.join(installed, "python", "bin", "python3.12"), "old runtime");
  const python = path.join(installed, "python", "bin", "python");
  await fsp.symlink(path.join(seed, "python", "bin", "python3.12"), python);
  await fsp.symlink("python", path.join(installed, "python", "bin", "python3"));
  const unrelated = path.join(installed, "outside");
  await fsp.symlink(root, unrelated);
  const siblingSeed = path.join(installed, "similar-prefix");
  await fsp.symlink(`${seed}-other/file`, siblingSeed);

  assert.equal(await repairSeedSymlinks(installed, seed), 1);
  assert.equal(await fsp.readlink(python), "python3.12");
  assert.equal(await fsp.readFile(python, "utf8"), "old runtime");
  assert.equal(await fsp.readlink(unrelated), root);
  assert.equal(await fsp.readlink(siblingSeed), `${seed}-other/file`);
  await fsp.rm(seed, { recursive: true });
  assert.equal(await fsp.readFile(path.join(installed, "python", "bin", "python3"), "utf8"), "old runtime");
  assert.equal(await repairSeedSymlinks(installed, seed), 0);
});
