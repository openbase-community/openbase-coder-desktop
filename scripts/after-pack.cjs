const { cpSync, existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, rmSync } = require("node:fs");
const path = require("node:path");

function isInside(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isAllowedFrameworkSymlink(linkPath, target) {
  const parts = linkPath.split(path.sep);
  const frameworkIndex = parts.findIndex((part) => part.endsWith(".framework"));
  if (frameworkIndex === -1) return false;
  if (path.isAbsolute(target)) return false;

  const frameworkRoot = parts.slice(0, frameworkIndex + 1).join(path.sep) || path.sep;
  const resolvedTarget = path.resolve(path.dirname(linkPath), target);
  return isInside(resolvedTarget, frameworkRoot);
}

function dereferenceSymlink(linkPath, resolvedTarget) {
  const stat = lstatSync(resolvedTarget);
  const tempPath = `${linkPath}.dereferenced-${process.pid}`;
  rmSync(tempPath, { force: true, recursive: true });

  if (stat.isDirectory()) {
    mkdirSync(path.dirname(tempPath), { recursive: true });
    cpSync(resolvedTarget, tempPath, {
      dereference: true,
      force: true,
      preserveTimestamps: true,
      recursive: true,
    });
  } else {
    cpSync(resolvedTarget, tempPath, {
      dereference: true,
      force: true,
      preserveTimestamps: true,
    });
  }

  rmSync(linkPath, { force: true, recursive: true });
  cpSync(tempPath, linkPath, {
    dereference: true,
    force: true,
    preserveTimestamps: true,
    recursive: stat.isDirectory(),
  });
  rmSync(tempPath, { force: true, recursive: true });
}

function normalizeSymlinks(rootPath) {
  const rootRealPath = realpathSync(rootPath);
  const repaired = [];
  const invalid = [];

  function visit(currentPath) {
    const stat = lstatSync(currentPath);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(currentPath);
      let resolvedTarget;
      try {
        resolvedTarget = realpathSync(currentPath);
      } catch (error) {
        invalid.push(`${currentPath} -> ${target} (${error.message})`);
        return;
      }

      if (isInside(resolvedTarget, rootRealPath) || isAllowedFrameworkSymlink(currentPath, target)) {
        return;
      }

      dereferenceSymlink(currentPath, resolvedTarget);
      repaired.push(`${path.relative(rootPath, currentPath)} -> ${resolvedTarget}`);
      return;
    }

    if (!stat.isDirectory()) return;
    for (const entry of require("node:fs").readdirSync(currentPath)) {
      visit(path.join(currentPath, entry));
    }
  }

  visit(rootPath);

  if (invalid.length > 0) {
    throw new Error(`Invalid symlinks in packed app:\n${invalid.join("\n")}`);
  }

  if (repaired.length > 0) {
    console.log(`Dereferenced ${repaired.length} unsafe symlink(s) before signing:`);
    for (const item of repaired.slice(0, 20)) {
      console.log(`- ${item}`);
    }
    if (repaired.length > 20) {
      console.log(`- ... ${repaired.length - 20} more`);
    }
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const productName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${productName}.app`);
  if (!existsSync(appPath)) {
    throw new Error(`Expected packed macOS app was not found: ${appPath}`);
  }

  normalizeSymlinks(appPath);
};
