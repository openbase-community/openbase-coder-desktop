import { describe, expect, it } from "vitest";

import {
  usesDurableLinuxOnboardingCompletion,
  usesManagedLinuxTailscale,
  waitsForLinuxOnboardingFlags,
} from "./pairingPlatform";

describe("usesManagedLinuxTailscale", () => {
  it("selects the managed flow only on Linux", () => {
    expect(usesManagedLinuxTailscale("linux")).toBe(true);
  });

  it("keeps Darwin and legacy preload bridges on the existing flow", () => {
    expect(usesManagedLinuxTailscale("darwin")).toBe(false);
    expect(usesManagedLinuxTailscale(undefined)).toBe(false);
  });

  it("uses durable onboarding completion only on Linux", () => {
    expect(usesDurableLinuxOnboardingCompletion("linux", true)).toBe(true);
    expect(usesDurableLinuxOnboardingCompletion("linux", false)).toBe(false);
    expect(usesDurableLinuxOnboardingCompletion("darwin", true)).toBe(false);
    expect(usesDurableLinuxOnboardingCompletion(undefined, true)).toBe(false);
  });

  it("waits for persisted flags only on Linux", () => {
    expect(waitsForLinuxOnboardingFlags("linux", false)).toBe(true);
    expect(waitsForLinuxOnboardingFlags("linux", true)).toBe(false);
    expect(waitsForLinuxOnboardingFlags("darwin", false)).toBe(false);
    expect(waitsForLinuxOnboardingFlags(undefined, false)).toBe(false);
  });
});
