import { Download, Loader2, Play, ShieldCheck } from "lucide-react";

import type { InstallerCommand, Prerequisite } from "../types";

export function PrerequisiteAction({
  disabled,
  item,
  onConnectTailscale,
  onDownloadTailscale,
  onOpenTailscale,
  onStartCommand,
  tailscaleConnecting,
}: {
  disabled: boolean;
  item: Prerequisite;
  onConnectTailscale: () => void;
  onDownloadTailscale: () => void;
  onOpenTailscale: () => void;
  onStartCommand: (commandId: InstallerCommand) => void;
  tailscaleConnecting: boolean;
}) {
  if (item.ok) {
    return null;
  }

  if (item.id === "openbase-coder") {
    return (
      <button
        className="inline-flex h-8 shrink-0 items-center gap-2 rounded-xl bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={() => onStartCommand("installCli")}
        type="button"
      >
        <Play aria-hidden className="h-3.5 w-3.5" />
        Activate CLI
      </button>
    );
  }

  if (item.id === "tailscale") {
    if (item.action === "connect-tailscale") {
      return (
        <button
          className="inline-flex h-8 shrink-0 items-center gap-2 rounded-xl bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onClick={onConnectTailscale}
          type="button"
        >
          {tailscaleConnecting ? (
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
          )}
          {tailscaleConnecting ? "Waiting for sign-in..." : "Connect Tailscale"}
        </button>
      );
    }

    if (item.action === "open-tailscale") {
      return (
        <button
          className="inline-flex h-8 shrink-0 items-center gap-2 rounded-xl bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onClick={onOpenTailscale}
          type="button"
        >
          <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
          Open Tailscale
        </button>
      );
    }

    return (
      <button
        className="inline-flex h-8 shrink-0 items-center gap-2 rounded-xl bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={onDownloadTailscale}
        type="button"
      >
        <Download aria-hidden className="h-3.5 w-3.5" />
        Get Tailscale (App Store)
      </button>
    );
  }

  return null;
}
