import { describe, expect, it } from "vitest";

import {
  usesDurableLinuxOnboardingCompletion,
  usesManagedLinuxTailscale,
  waitsForLinuxOnboardingFlags,
} from "./pairingPlatform";

describe("usesManagedLinuxTailscale", () => {
  it("does not activate the legacy Tailscale-app flow on Linux", () => {
    expect(usesManagedLinuxTailscale("linux")).toBe(false);
  });

  it("keeps Darwin and legacy preload bridges on the existing flow", () => {
    expect(usesManagedLinuxTailscale("darwin")).toBe(false);
    expect(usesManagedLinuxTailscale(undefined)).toBe(false);
  });

  it("does not use legacy Linux completion state", () => {
    expect(usesDurableLinuxOnboardingCompletion("linux", true)).toBe(false);
    expect(usesDurableLinuxOnboardingCompletion("linux", false)).toBe(false);
    expect(usesDurableLinuxOnboardingCompletion("darwin", true)).toBe(false);
    expect(usesDurableLinuxOnboardingCompletion(undefined, true)).toBe(false);
  });

  it("does not wait for legacy Linux flags", () => {
    expect(waitsForLinuxOnboardingFlags("linux", false)).toBe(false);
    expect(waitsForLinuxOnboardingFlags("linux", true)).toBe(false);
    expect(waitsForLinuxOnboardingFlags("darwin", false)).toBe(false);
    expect(waitsForLinuxOnboardingFlags(undefined, false)).toBe(false);
  });
});
