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
  mobileOnTailscale: boolean;
  tailscalePaired: boolean;
};

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
): boolean {
  return devicesPaired && routesHealthy === true;
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
      return "No signed-in iPhone has registered with Openbase Cloud yet.";
    case "mobile_tailscale_missing":
      return "The iPhone is registered, but it has not reported a private-network address.";
    case "tailnet_mismatch":
      return "This Mac and iPhone appear to be on different private networks.";
    default:
      return fact.message ?? null;
  }
}

export function deriveCloudPairingFacts(
  cloudState: CloudOnboardingState | null,
): CloudPairingFacts {
  const cloudDevices = cloudState?.devices ?? [];
  const desktopDevices = cloudDevices.filter((device) => device.kind === "desktop");
  const mobileDevices = cloudDevices.filter((device) => device.kind === "mobile");
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
      diagnosticMessages.push("No signed-in iPhone has registered with Openbase Cloud yet.");
    } else if (!mobileOnTailscale) {
      diagnosticMessages.push(
        "The iPhone is registered, but it has not reported a private-network address.",
      );
    }
  }

  return {
    desktopCloudRegistered,
    desktopOnTailscale,
    diagnosticMessages,
    mobileAuthenticated,
    mobileOnTailscale,
    tailscalePaired,
  };
}
