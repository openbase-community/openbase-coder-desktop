import { useCallback, useState } from "react";

import type { InstallerApi } from "./types";

export function useLinuxTailscaleOnboarding(
  installer: InstallerApi | undefined,
  refreshTailscaleIdentity: () => Promise<void>,
) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    if (installer?.platform !== "linux" || !installer.connectLinuxTailscale) {
      setError("Managed Tailscale onboarding is unavailable on this machine.");
      return;
    }

    setConnecting(true);
    setError(null);
    try {
      const result = await installer.connectLinuxTailscale();
      if (!result.ok) {
        setError(result.error || "Could not connect this workspace to Tailscale.");
        return;
      }
      await refreshTailscaleIdentity();
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Could not connect this workspace to Tailscale.",
      );
    } finally {
      setConnecting(false);
    }
  }, [installer, refreshTailscaleIdentity]);

  return { connect, connecting, error };
}
