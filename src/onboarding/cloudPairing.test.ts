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
        "The iPhone is registered, but it has not reported a private-network address.",
      ],
      mobileAuthenticated: true,
      mobileOnTailscale: false,
      tailscalePaired: false,
    });
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
        "The iPhone is registered, but it has not reported a private-network address.",
      ],
      mobileAuthenticated: true,
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
      "This Mac and iPhone appear to be on different private networks.",
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
  it("requires both cloud rendezvous and healthy local routes", () => {
    expect(privateNetworkPairingReady(true, true)).toBe(true);
    expect(privateNetworkPairingReady(true, false)).toBe(false);
    expect(privateNetworkPairingReady(true, undefined)).toBe(false);
    expect(privateNetworkPairingReady(false, true)).toBe(false);
  });
});

describe("localBackendReadyForOnboarding", () => {
  it("keeps durable backend readiness independent of deferred network routes", () => {
    expect(localBackendReadyForOnboarding("ready")).toBe(true);
    expect(localBackendReadyForOnboarding("checking")).toBe(false);
    expect(localBackendReadyForOnboarding("error")).toBe(false);
  });
});
