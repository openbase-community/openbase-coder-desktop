import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Tripwire: package.json was once clobbered down to a bare dependency list
// (losing every script, the electron-builder config, and the devDependencies,
// and leaving a stray openbaseDevBuild flag that silently disabled
// auto-update for production builds). These assertions make that class of
// accident fail the test suite instead of surfacing at release time.
type PackageManifest = {
  description?: string;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  build?: {
    appId?: string;
    artifactName?: string;
    executableName?: string;
    productName?: string;
    protocols?: Array<{ name?: string; schemes?: string[] }>;
    mac?: { identity?: string };
    publish?: { url?: string };
  };
  openbaseDevBuild?: boolean;
};

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"),
) as PackageManifest;
const publishScript = readFileSync(
  path.resolve(__dirname, "..", "scripts", "publish-s3.mjs"),
  "utf8",
);

describe("package.json release integrity", () => {
  it("keeps the release scripts", () => {
    for (const script of ["build", "dist:mac", "dist:mac:publish", "install:local"]) {
      expect(pkg.scripts?.[script], `scripts.${script}`).toBeTruthy();
    }
  });

  it("keeps the electron-builder config and update feed", () => {
    expect(pkg.build?.appId).toBe("tech.openbase.coder.desktop");
    expect(pkg.build?.mac?.identity).toBeTruthy();
    expect(pkg.build?.publish?.url).toMatch(/s3\.amazonaws\.com/);
  });

  it("ships the Openbase name without changing compatibility identifiers", () => {
    expect(pkg.build?.productName).toBe("Openbase");
    expect(pkg.build?.executableName).toBe("Openbase");
    expect(pkg.build?.artifactName).toMatch(/^Openbase-/);
    expect(pkg.build?.appId).toBe("tech.openbase.coder.desktop");
    expect(pkg.build?.protocols?.[0]?.schemes).toContain("openbase-coder");
  });

  it("keeps the toolchain devDependencies", () => {
    for (const dep of ["electron", "electron-builder", "vite", "vitest"]) {
      expect(pkg.devDependencies?.[dep], `devDependencies.${dep}`).toBeTruthy();
    }
  });

  it("never sets openbaseDevBuild in source (dev installs inject it at build time)", () => {
    expect(pkg.openbaseDevBuild).toBeUndefined();
  });

  it("keeps new and legacy latest download aliases during the rebrand", () => {
    expect(publishScript).toContain("Openbase-latest-");
    expect(publishScript).toContain("Openbase-Coder-latest-");
  });
});
