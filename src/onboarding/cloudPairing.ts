import type {
  CloudOnboardingDevice,
  CloudOnboardingMissingFact,
  CloudOnboardingState,
} from "./types";

export type CloudPairingFacts = {
  desktopCloudRegistered: boolean;
  desktopOnTailscale: boolean;
  diagnosticMessages: string[];
  mobileAuthenticated: boolean;
  /**
   * A mobile device reported in within MOBILE_RECENT_SIGNAL_MS. Distinguishes a
   * phone that is genuinely present now from a stale device row (old install,
   * reset phone) that would otherwise keep `mobileAuthenticated` true and skip
   * the download QR forever. Onboarding gates leaving the QR page on this.
   */
  mobileRecentlyActive: boolean;
  mobileOnTailscale: boolean;
  tailscalePaired: boolean;
};

/**
 * How fresh a mobile device's `last_seen` must be to count as "a phone is here
 * now" for onboarding. The mobile app re-registers on every foreground/poll while
 * onboarding, so an actively-used phone stays well inside this window; a row
 * left by a prior install or a wiped phone ages out and re-surfaces the QR.
 */
export const MOBILE_RECENT_SIGNAL_MS = 15 * 60 * 1000;

export function hasAdvertisedTailscale(device: CloudOnboardingDevice) {
  return Boolean(
    device.has_tailscale ??
      device.tailscale_ip ??
      device.tailscale_magic_dns ??
      device.tailscale,
  );
}

export function privateNetworkPairingReady(
  devicesPaired: boolean,
  routesHealthy: boolean | undefined,
  backendReady: boolean,
  voiceRuntimeReady: boolean | undefined,
): boolean {
  return (
    devicesPaired &&
    routesHealthy === true &&
    backendReady &&
    voiceRuntimeReady === true
  );
}

export function localBackendReadyForOnboarding(status: string): boolean {
  // Managed networking is intentionally connected after account login. Route
  // health gates pairing, not durable CLI/backend setup, so a relaunch before
  // pairing must resume onboarding instead of returning to Setup.
  return status === "ready";
}

function factMessage(fact: CloudOnboardingMissingFact) {
  switch (fact.code) {
    case "desktop_not_registered":
      return "This Mac has not registered with Openbase Cloud yet.";
    case "desktop_tailscale_missing":
      return "This Mac is registered, but it has not reported a private-network address.";
    case "mobile_not_registered":
      return "No signed-in phone has registered with Openbase Cloud yet.";
    case "mobile_tailscale_missing":
      return "The phone is registered, but it has not reported a private-network address.";
    case "tailnet_mismatch":
      return "This Mac and phone appear to be on different private networks.";
    default:
      return fact.message ?? null;
  }
}

export function deriveCloudPairingFacts(
  cloudState: CloudOnboardingState | null,
  nowMs: number = Date.now(),
): CloudPairingFacts {
  const cloudDevices = cloudState?.devices ?? [];
  const desktopDevices = cloudDevices.filter((device) => device.kind === "desktop");
  const mobileDevices = cloudDevices.filter((device) => device.kind === "mobile");
  const mobileRecentlyActive = mobileDevices.some((device) => {
    if (!device.last_seen) return false;
    const seen = Date.parse(device.last_seen);
    return Number.isFinite(seen) && nowMs - seen <= MOBILE_RECENT_SIGNAL_MS;
  });
  const diagnostics = cloudState?.diagnostics;
  const desktop = diagnostics?.desktop;
  const mobile = diagnostics?.mobile;

  const desktopCloudRegistered =
    desktop?.has_registered ?? (cloudState?.desktop_count ?? desktopDevices.length) > 0;
  const desktopOnTailscale =
    desktop?.has_tailscale ?? desktopDevices.some(hasAdvertisedTailscale);
  const mobileAuthenticated =
    mobile?.has_registered ?? (cloudState?.mobile_count ?? mobileDevices.length) > 0;
  const mobileOnTailscale =
    mobile?.has_tailscale ?? mobileDevices.some(hasAdvertisedTailscale);
  const inferredPairingReady =
    desktopCloudRegistered && desktopOnTailscale && mobileAuthenticated && mobileOnTailscale;
  const tailscalePaired = diagnostics?.paired === false ? false : inferredPairingReady;
  const diagnosticMessages =
    diagnostics?.missing_facts?.map(factMessage).filter((message): message is string =>
      Boolean(message),
    ) ?? [];

  if (cloudState && diagnosticMessages.length === 0 && !tailscalePaired) {
    if (!desktopCloudRegistered) {
      diagnosticMessages.push("This Mac has not registered with Openbase Cloud yet.");
    } else if (!desktopOnTailscale) {
      diagnosticMessages.push(
        "This Mac is registered, but it has not reported a private-network address.",
      );
    }
    if (!mobileAuthenticated) {
      diagnosticMessages.push("No signed-in phone has registered with Openbase Cloud yet.");
    } else if (!mobileOnTailscale) {
      diagnosticMessages.push(
        "The phone is registered, but it has not reported a private-network address.",
      );
    }
  }

  return {
    desktopCloudRegistered,
    desktopOnTailscale,
    diagnosticMessages,
    mobileAuthenticated,
    mobileRecentlyActive,
    mobileOnTailscale,
    tailscalePaired,
  };
}
