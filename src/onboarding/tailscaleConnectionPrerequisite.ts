import type { Prerequisite, TailscaleIdentityStatus } from "./types";

export type TailnetProvider = "tailscale" | "netmesh" | "netmesh-tsnet";

export function applyTailscaleConnectionPrerequisite(
  prerequisites: Prerequisite[],
  _platform: string | undefined,
  _identity: TailscaleIdentityStatus | null,
  tailnetProvider: TailnetProvider = "tailscale",
): Prerequisite[] {
  // Electron onboarding deliberately does not offer the third-party Tailscale
  // app transport. The compatibility provider id can still be present on an
  // older install, but setup stays blocked until the user chooses Openbase VPN
  // or Openbase Direct.
  if (tailnetProvider === "tailscale") {
    return prerequisites.map((item) =>
      item.id === "private-network"
        ? {
            ...item,
            action: undefined,
            detail: "Choose Openbase VPN or Openbase Direct before setup.",
            label: "Private networking",
            ok: false,
          }
        : item,
    );
  }

  return prerequisites.map((item) => {
    if (item.id !== "private-network") {
      return item;
    }
    return {
      ...item,
      action: undefined,
      detail:
        tailnetProvider === "netmesh"
          ? "Openbase VPN selected. No Tailscale app or Tailscale account is used."
          : "Openbase Direct selected. This embedded connection does not install a VPN.",
      label: "Private networking",
      ok: true,
    };
  });
}
