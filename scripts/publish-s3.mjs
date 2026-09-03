import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(repoRoot, "release");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
// The electron-updater generic feed URL in package.json (build.publish.url,
// `https://<bucket>.s3.amazonaws.com/${os}`) is the source of truth for the
// default bucket; ${os} resolves to the same "mac"/"linux" values used as
// prefixes here.
const publishUrlMatch = /^https:\/\/([^./]+)\.s3\.amazonaws\.com\//.exec(
  packageJson.build?.publish?.url ?? "",
);
if (!publishUrlMatch) {
  throw new Error("package.json build.publish.url must be an s3.amazonaws.com generic feed URL");
}
const bucket = process.env.OPENBASE_CODER_RELEASE_BUCKET ?? publishUrlMatch[1];
const prefix = process.env.OPENBASE_CODER_RELEASE_PREFIX ?? "mac";
// Staging builds publish to "<os>-staging" prefixes; artifact/feed selection
// keys off the base OS so both channels ship identical file sets.
const baseOs = prefix.replace(/-staging$/, "");
const publicBaseUrl = `https://${bucket}.s3.amazonaws.com/${prefix}`;
// electron-updater on macOS installs from the zip target; the dmg is only the
// human download. The blockmap enables differential downloads.
const artifactExtensionsByOs = {
  linux: ["AppImage"],
  mac: ["dmg", "zip", "zip.blockmap"],
};
const artifactExtensions = artifactExtensionsByOs[baseOs] ?? ["dmg", "AppImage"];
// electron-builder emits the updater feed metadata whenever a publish config
// exists, even with --publish never.
const updateFeedFilesByOs = {
  linux: ["latest-linux.yml"],
  mac: ["latest-mac.yml"],
};
const currentArtifactPattern = new RegExp(
  `^Openbase-${packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-.+\\.(${artifactExtensions.map((extension) => extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`,
);
const versionedArtifactPrefix = `Openbase-${packageJson.version}-`;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function contentType(fileName) {
  if (fileName.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (fileName.endsWith(".AppImage")) return "application/x-executable";
  if (fileName.endsWith(".zip")) return "application/zip";
  if (fileName.endsWith(".yml")) return "text/yaml";
  return "application/octet-stream";
}

function publicUrl(fileName) {
  return `${publicBaseUrl}/${encodeURIComponent(fileName)}`;
}

function latestFileName(fileName) {
  if (!fileName.startsWith(versionedArtifactPrefix)) {
    throw new Error(`Unable to derive latest alias for ${fileName}`);
  }

  return `Openbase-latest-${fileName.slice(versionedArtifactPrefix.length)}`;
}

// Keep established public download URLs alive while marketing and Cloud
// surfaces roll over to the new visible artifact name. This is a download
// alias only; packaged product names and updater metadata remain Openbase.
function legacyLatestFileName(fileName) {
  if (!fileName.startsWith(versionedArtifactPrefix)) {
    throw new Error(`Unable to derive legacy latest alias for ${fileName}`);
  }

  return `Openbase-Coder-latest-${fileName.slice(versionedArtifactPrefix.length)}`;
}

function upload(filePath, fileName, cacheControl) {
  const s3Uri = `s3://${bucket}/${prefix}/${fileName}`;
  run("aws", [
    "s3",
    "cp",
    filePath,
    s3Uri,
    "--acl",
    "public-read",
    "--content-type",
    contentType(fileName),
    "--cache-control",
    cacheControl,
  ]);

  const url = publicUrl(fileName);
  run("curl", ["--fail", "--head", "--silent", "--show-error", url], { capture: true });
  console.log(url);
}

run("aws", ["sts", "get-caller-identity"], { capture: true });

const artifactNames = readdirSync(releaseDir)
  .filter((fileName) => currentArtifactPattern.test(fileName))
  .sort();

if (artifactNames.length === 0) {
  throw new Error(`No release artifacts found in ${releaseDir}`);
}

for (const fileName of artifactNames) {
  const filePath = path.join(releaseDir, fileName);
  if (!statSync(filePath).isFile()) continue;

  upload(filePath, fileName, "public, max-age=31536000, immutable");
  for (const alias of new Set([
    latestFileName(fileName),
    legacyLatestFileName(fileName),
  ])) {
    upload(filePath, alias, "public, max-age=300");
  }
}

for (const fileName of updateFeedFilesByOs[baseOs] ?? []) {
  const filePath = path.join(releaseDir, fileName);
  if (!existsSync(filePath)) {
    throw new Error(
      `Missing ${fileName} in ${releaseDir}; electron-builder should emit it when build.publish is configured.`,
    );
  }
  upload(filePath, fileName, "public, max-age=300");
}
