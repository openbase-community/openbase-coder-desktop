import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const destRoot = path.join(repoRoot, "bundled", "OpenbaseCoderCLI");
const metadataFileName = "openbase-coder-package.json";

const candidates = [
  process.env.OPENBASE_CODER_DESKTOP_CLI_PACKAGE_DIR,
  process.env.OPENBASE_CODER_STANDALONE_PACKAGE_DIR,
  path.join(workspaceRoot, "cli", "dist", "openbase-coder-package"),
  path.join(workspaceRoot, "cli", "build", "openbase-coder-package"),
].filter(Boolean);

function validatePackage(packageRoot) {
  const metadataPath = path.join(packageRoot, metadataFileName);
  const cliPath = path.join(packageRoot, "bin", "openbase-coder");
  const livekitPath = path.join(packageRoot, "bin", "livekit-server");
  const consolePath = path.join(packageRoot, "console", "index.html");

  for (const requiredPath of [metadataPath, cliPath, livekitPath, consolePath]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Missing required standalone package file: ${requiredPath}`);
    }
  }

  if (!statSync(cliPath).isFile()) {
    throw new Error(`Standalone CLI is not a file: ${cliPath}`);
  }

  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (!metadata.version || !metadata.target) {
    throw new Error(`${metadataPath} must include version and target.`);
  }

  return metadata;
}

function resolveSourcePackage() {
  const errors = [];
  for (const candidate of candidates) {
    const packageRoot = path.resolve(candidate);
    if (!existsSync(packageRoot)) {
      errors.push(`${packageRoot} does not exist`);
      continue;
    }
    try {
      return { metadata: validatePackage(packageRoot), packageRoot };
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(
    [
      "No valid Openbase Coder standalone package found for desktop bundling.",
      "Set OPENBASE_CODER_DESKTOP_CLI_PACKAGE_DIR to a package directory built by cli/scripts/build_standalone_package.py.",
      ...errors.map((error) => `- ${error}`),
    ].join("\n"),
  );
}

// With dereference:true, cpSync leaves nested symlinks as symlinks but
// rewrites their relative targets to absolute paths into the source tree,
// so the staged copy silently depends on the workspace checkout.
// verbatimSymlinks preserves the package's relative symlinks as-is.
function assertSelfContained(root) {
  const resolvedRoot = realpathSync(root) + path.sep;
  for (const entry of readdirSync(root, { recursive: true })) {
    const entryPath = path.join(root, entry);
    if (!lstatSync(entryPath).isSymbolicLink()) {
      continue;
    }
    const target = realpathSync(entryPath);
    if (!(target + path.sep).startsWith(resolvedRoot)) {
      throw new Error(
        `Staged package is not self-contained; symlink escapes the bundle: ${entryPath} -> ${target}`,
      );
    }
  }
}

const source = resolveSourcePackage();
rmSync(destRoot, { force: true, recursive: true });
mkdirSync(path.dirname(destRoot), { recursive: true });
cpSync(source.packageRoot, destRoot, {
  verbatimSymlinks: true,
  force: true,
  preserveTimestamps: true,
  recursive: true,
});

validatePackage(destRoot);
assertSelfContained(destRoot);
console.log(
  `Staged Openbase Coder CLI ${source.metadata.version} (${source.metadata.target}) at ${path.relative(repoRoot, destRoot)}`,
);
