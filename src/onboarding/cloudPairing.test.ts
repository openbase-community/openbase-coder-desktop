import { describe, expect, it } from "vitest";

import {
  deriveCloudPairingFacts,
  localBackendReadyForOnboarding,
  privateNetworkPairingReady,
} from "./cloudPairing";
import type { CloudOnboardingState } from "./types";

describe("deriveCloudPairingFacts", () => {
  it("falls back to raw devices for older cloud responses", () => {
    const state: CloudOnboardingState = {
      desktop_count: 1,
      mobile_count: 1,
      devices: [
        { kind: "desktop", tailscale_magic_dns: "mac.tailnet.ts.net" },
        { kind: "mobile" },
      ],
    };

    expect(deriveCloudPairingFacts(state)).toEqual({
      desktopCloudRegistered: true,
      desktopOnTailscale: true,
      diagnosticMessages: [
        "The phone is registered, but it has not reported a private-network address.",
      ],
      mobileAuthenticated: true,
      mobileRecentlyActive: false,
      mobileOnTailscale: false,
      tailscalePaired: false,
    });
  });

  it("marks the phone recently active only within the recency window", () => {
    const now = Date.parse("2026-09-14T20:00:00.000Z");
    const fresh: CloudOnboardingState = {
      devices: [{ kind: "mobile", last_seen: "2026-09-14T19:58:00.000Z" }],
    };
    const stale: CloudOnboardingState = {
      devices: [{ kind: "mobile", last_seen: "2026-09-10T12:00:00.000Z" }],
    };
    const missing: CloudOnboardingState = { devices: [{ kind: "mobile" }] };

    expect(deriveCloudPairingFacts(fresh, now).mobileRecentlyActive).toBe(true);
    // A stale row (old install / wiped phone) stays authenticated but not
    // "recently active", so onboarding keeps showing the download QR.
    expect(deriveCloudPairingFacts(stale, now).mobileAuthenticated).toBe(true);
    expect(deriveCloudPairingFacts(stale, now).mobileRecentlyActive).toBe(false);
    expect(deriveCloudPairingFacts(missing, now).mobileRecentlyActive).toBe(false);
  });

  it("prefers explicit cloud diagnostics when available", () => {
    const state: CloudOnboardingState = {
      diagnostics: {
        desktop: { has_registered: true, has_tailscale: true },
        mobile: { has_registered: true, has_tailscale: false },
        missing_facts: [
          {
            code: "mobile_tailscale_missing",
            message: "The iPhone is registered, but it has not reported a Tailscale address.",
          },
        ],
        paired: false,
      },
      devices: [],
    };

    expect(deriveCloudPairingFacts(state)).toEqual({
      desktopCloudRegistered: true,
      desktopOnTailscale: true,
      diagnosticMessages: [
        "The phone is registered, but it has not reported a private-network address.",
      ],
      mobileAuthenticated: true,
      mobileRecentlyActive: false,
      mobileOnTailscale: false,
      tailscalePaired: false,
    });
  });

  it("uses known messages for diagnostic codes without server copy", () => {
    const state: CloudOnboardingState = {
      diagnostics: {
        desktop: { has_registered: true, has_tailscale: true },
        mobile: { has_registered: true, has_tailscale: true },
        missing_facts: [{ code: "tailnet_mismatch" }],
        paired: false,
      },
    };

    expect(deriveCloudPairingFacts(state).diagnosticMessages).toEqual([
      "This Mac and phone appear to be on different private networks.",
    ]);
  });

  it("does not allow a paired diagnostic to skip Mac cloud registration", () => {
    const state: CloudOnboardingState = {
      diagnostics: {
        desktop: { has_registered: false, has_tailscale: true },
        mobile: { has_registered: true, has_tailscale: true },
        paired: true,
      },
    };

    expect(deriveCloudPairingFacts(state)).toEqual({
      desktopCloudRegistered: false,
      desktopOnTailscale: true,
      diagnosticMessages: ["This Mac has not registered with Openbase Cloud yet."],
      mobileAuthenticated: true,
      mobileRecentlyActive: false,
      mobileOnTailscale: true,
      tailscalePaired: false,
    });
  });

  it("synthesizes missing fact messages when cloud diagnostics are incomplete", () => {
    const state: CloudOnboardingState = {
      devices: [{ kind: "mobile", tailscale_magic_dns: "phone.tailnet.ts.net" }],
      mobile_count: 1,
    };

    expect(deriveCloudPairingFacts(state).diagnosticMessages).toEqual([
      "This Mac has not registered with Openbase Cloud yet.",
    ]);
  });
});

describe("privateNetworkPairingReady", () => {
  it("requires cloud rendezvous, healthy routes, the backend, and voice services", () => {
    expect(privateNetworkPairingReady(true, true, true, true)).toBe(true);
    expect(privateNetworkPairingReady(true, false, true, true)).toBe(false);
    expect(privateNetworkPairingReady(true, undefined, true, true)).toBe(false);
    expect(privateNetworkPairingReady(false, true, true, true)).toBe(false);
    expect(privateNetworkPairingReady(true, true, false, true)).toBe(false);
    expect(privateNetworkPairingReady(true, true, true, false)).toBe(false);
    expect(privateNetworkPairingReady(true, true, true, undefined)).toBe(false);
  });
});

describe("localBackendReadyForOnboarding", () => {
  it("keeps durable backend readiness independent of deferred network routes", () => {
    expect(localBackendReadyForOnboarding("ready")).toBe(true);
    expect(localBackendReadyForOnboarding("checking")).toBe(false);
    expect(localBackendReadyForOnboarding("error")).toBe(false);
  });
});
