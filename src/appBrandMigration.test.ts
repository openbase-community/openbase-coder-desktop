import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  appBundleMigrationPlan,
  enclosingAppBundle,
}: {
  appBundleMigrationPlan: (input: {
    executablePath: string;
    isPackaged: boolean;
    platform: string;
    targetExists: boolean;
  }) => { action: string; source?: string; target?: string };
  enclosingAppBundle: (path: string) => string | null;
} = require("../electron/app-brand-migration.cjs");

describe("Openbase app bundle migration", () => {
  it("finds the containing app bundle", () => {
    expect(
      enclosingAppBundle(
        "/Applications/Openbase Coder.app/Contents/MacOS/Openbase",
      ),
    ).toBe("/Applications/Openbase Coder.app");
  });

  it("renames the legacy packaged macOS bundle", () => {
    expect(
      appBundleMigrationPlan({
        executablePath:
          "/Applications/Openbase Coder.app/Contents/MacOS/Openbase",
        isPackaged: true,
        platform: "darwin",
        targetExists: false,
      }),
    ).toEqual({
      action: "rename",
      source: "/Applications/Openbase Coder.app",
      target: "/Applications/Openbase.app",
    });
  });

  it("preserves both bundles when the renamed app already exists", () => {
    expect(
      appBundleMigrationPlan({
        executablePath:
          "/Applications/Openbase Coder.app/Contents/MacOS/Openbase",
        isPackaged: true,
        platform: "darwin",
        targetExists: true,
      }).action,
    ).toBe("conflict");
  });

  it("does nothing for development and already-renamed bundles", () => {
    expect(
      appBundleMigrationPlan({
        executablePath: "/Applications/Openbase.app/Contents/MacOS/Openbase",
        isPackaged: true,
        platform: "darwin",
        targetExists: false,
      }).action,
    ).toBe("none");
    expect(
      appBundleMigrationPlan({
        executablePath:
          "/Applications/Openbase Coder.app/Contents/MacOS/Openbase",
        isPackaged: false,
        platform: "darwin",
        targetExists: false,
      }).action,
    ).toBe("none");
  });
});
