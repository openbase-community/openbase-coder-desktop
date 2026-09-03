import { execFileSync } from "node:child_process";

function output(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

export function configuredSigningIdentity() {
  const configured = process.env.OPENBASE_CODER_COMPANION_CODESIGN_IDENTITY?.trim();
  if (configured) return configured;

  try {
    const identities = output("security", ["find-identity", "-v", "-p", "codesigning"])
      .split("\n")
      .map((line) => line.match(/"([^"]+)"/)?.[1])
      .filter(Boolean);
    return (
      identities.find((identity) => identity.startsWith("Developer ID Application:")) ||
      identities.find((identity) => identity.startsWith("Apple Development:")) ||
      null
    );
  } catch {
    return null;
  }
}

function signPath(targetPath, label, deep) {
  const signingIdentity = configuredSigningIdentity();
  const args = ["--force"];
  if (deep) args.push("--deep");
  if (signingIdentity) args.push("--options", "runtime");
  args.push("--sign", signingIdentity || "-", targetPath);
  execFileSync("codesign", args, { stdio: "inherit" });

  if (signingIdentity) {
    console.log(`Signed ${label} with ${signingIdentity}`);
  } else {
    console.warn(`Signed ${label} ad-hoc because no code signing identity was available.`);
  }
}

export function signExecutable(executablePath, label = "macOS executable") {
  signPath(executablePath, label, false);
}

export function signAppBundle(appPath, label = "macOS app") {
  signPath(appPath, label, true);
}
