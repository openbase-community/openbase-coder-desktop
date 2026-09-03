import type { Prerequisite, TailscaleIdentityStatus } from "./types";

export function applyTailscaleConnectionPrerequisite(
  prerequisites: Prerequisite[],
  platform: string | undefined,
  identity: TailscaleIdentityStatus | null,
): Prerequisite[] {
  if (platform !== "darwin" && platform !== "linux") {
    return prerequisites;
  }

  return prerequisites.map((item) => {
    if (item.id !== "tailscale" || !item.ok) {
      return item;
    }

    if (identity?.connected) {
      const name = identity.dnsName || identity.hostName || identity.ip;
      return {
        ...item,
        detail: name ? `Connected to Tailscale as ${name}.` : "Connected to Tailscale.",
      };
    }

    return {
      ...item,
      action: platform === "linux" ? "connect-tailscale" : "open-tailscale",
      detail:
        platform === "linux"
          ? "Tailscale is installed but not connected. Connect here before setup so Tailscale Serve can be configured."
          : "Tailscale is installed but not connected. Open Tailscale and sign in before setup so Tailscale Serve can be configured.",
      ok: false,
    };
  });
}
