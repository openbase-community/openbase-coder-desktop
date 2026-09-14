import { ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PrimaryButton } from "./PrimaryButton";
import { SecondaryButton } from "./SecondaryButton";
import {
  SystemSettingsGuide,
  type SystemSettingsSlide,
} from "./SystemSettingsGuide";
import allowBackgroundImage from "../../assets/onboarding/allow-openbase-netmesh-background.png";
import authorizeChangeImage from "../../assets/onboarding/authorize-login-items-change.png";
import type { NetmeshCompanionStatus } from "../types";

const APPROVAL_SLIDES: SystemSettingsSlide[] = [
  {
    alt: "Login Items and Extensions with OpenbaseNetmeshCompanion enabled under Allow in the Background",
    body: "Find OpenbaseNetmeshCompanion under Allow in the Background and turn its switch on.",
    imageClassName: "object-bottom",
    src: allowBackgroundImage,
    title: "Turn on the Openbase background item",
  },
  {
    alt: "macOS Login Items authorization sheet asking for the Mac password",
    body: "macOS may ask for this Mac's password. Enter it and choose Modify Settings.",
    src: authorizeChangeImage,
    title: "Approve the System Settings change",
  },
];

/**
 * Setup card for the Openbase VPN (netmesh) on macOS. Drives the netmesh
 * companion nested inside this app — no standalone Openbase Netmesh app —
 * through the three states that matter: register the system service, approve
 * it in System Settings, and connect (enrollment happens with the signed-in
 * Openbase account behind the connect call).
 */
export function NetmeshVpnCard({
  connecting = false,
  onConnect,
}: {
  connecting?: boolean;
  onConnect?: () => void;
} = {}) {
  const installer = window.__OPENBASE_INSTALLER__;
  const [status, setStatus] = useState<NetmeshCompanionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!installer?.netmeshStatus) return;
    const next = await installer.netmeshStatus();
    setStatus(next);
  }, [installer]);

  useEffect(() => {
    void refresh();
    // Approval happens outside the app (System Settings), so poll while the
    // card is mounted to catch the flip without a manual refresh.
    pollRef.current = window.setInterval(() => void refresh(), 3000);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [refresh]);

  const run = useCallback(
    async (action: () => Promise<NetmeshCompanionStatus>) => {
      setBusy(true);
      setError(null);
      try {
        const next = await action();
        setStatus(next);
        if (next.error) setError(next.error);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const openLoginItemsSettings = useCallback(async () => {
    setError(null);
    try {
      const result = await installer?.openLoginItemsSettings();
      if (result && !result.ok) {
        setError(result.error ?? "Could not open Login Items & Extensions.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [installer]);

  if (!installer?.netmeshStatus) return null;

  const helper = status?.helper ?? "unknown";
  const connected = status?.backendState === "Running";
  const needsApproval = helper === "requiresApproval";
  const needsRegister = helper === "notRegistered" || helper === "notFound";

  const stateText = connected
    ? `Connected${status?.selfIP ? ` · ${status.selfIP}` : ""}`
    : needsApproval
      ? "Waiting for approval in System Settings"
      : needsRegister
        ? "The Openbase VPN service is not installed yet"
        : helper === "enabled"
          ? "Ready to connect"
          : "Checking the Openbase VPN…";

  return (
    <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4">
      <div className="text-sm font-medium text-zinc-950">Openbase VPN</div>
      <div className="mt-1 text-xs leading-5 text-zinc-600">{stateText}</div>
      {needsApproval && (
        <>
          <div className="mt-1 text-xs leading-5 text-zinc-600">
            Openbase will keep checking and continue automatically after you
            enable the background item.
          </div>
          <SystemSettingsGuide slides={APPROVAL_SLIDES} />
        </>
      )}
      {error && (
        <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-900">
          {error}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        {needsApproval && (
          <SecondaryButton onClick={() => void openLoginItemsSettings()}>
            <ExternalLink aria-hidden className="h-4 w-4" />
            Open System Settings
          </SecondaryButton>
        )}
        {needsRegister && (
          <PrimaryButton
            disabled={busy}
            onClick={() => void run(() => installer.netmeshRegister())}
          >
            {busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            Install the VPN service
          </PrimaryButton>
        )}
        {helper === "enabled" && !connected && (
          <PrimaryButton
            disabled={busy || connecting}
            onClick={() => {
              if (onConnect) {
                setError(null);
                onConnect();
                return;
              }
              void run(() => installer.netmeshConnect());
            }}
          >
            {(busy || connecting) && (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            )}
            Connect
          </PrimaryButton>
        )}
        {connected && (
          <PrimaryButton
            disabled={busy}
            onClick={() => void run(() => installer.netmeshDisconnect())}
          >
            Disconnect
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}
