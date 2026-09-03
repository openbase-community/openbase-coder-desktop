import { ArrowRight, Loader2, RefreshCw } from "lucide-react";

import { NetmeshVpnCard } from "../components/NetmeshVpnCard";
import { PageShell } from "../components/PageShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { StatusIcon } from "../components/StatusIcon";
import { TerminalOutput } from "../components/TerminalOutput";
import { PulsingDot } from "../motion";
import type {
  InstallerCommand,
  TailnetProviderChoice,
  TailscaleIdentityStatus,
} from "../types";

export function PairingPage({
  cloudStateError,
  commandError,
  commandLines,
  desktopCloudRegistered,
  desktopOnTailscale,
  lastExit,
  macAuthenticated,
  mobileAuthenticated,
  mobileOnTailscale,
  networkConnecting,
  onConnectNetwork,
  onContinue,
  onRefreshTailscale,
  pairingDiagnosticMessages,
  registrationRunning,
  tailscaleIdentity,
  tailscalePaired,
  tailnetProvider,
}: {
  cloudStateError: string | null;
  commandError: string | null;
  commandLines: string[];
  desktopCloudRegistered: boolean;
  desktopOnTailscale: boolean;
  lastExit: { code: number | null; commandId: InstallerCommand } | null;
  macAuthenticated: boolean;
  mobileAuthenticated: boolean;
  mobileOnTailscale: boolean;
  networkConnecting: boolean;
  onConnectNetwork: () => void;
  onContinue: () => void;
  onRefreshTailscale: () => void;
  pairingDiagnosticMessages: string[];
  registrationRunning: boolean;
  tailscaleIdentity: TailscaleIdentityStatus | null;
  tailscalePaired: boolean;
  tailnetProvider: TailnetProviderChoice;
}) {
  const tailscaleKnown = tailscaleIdentity !== null;
  const tailscaleInstalled = tailscaleIdentity?.installed === true;
  const tailscaleConnected = tailscaleIdentity?.connected === true;
  const macRegistrationComplete = desktopCloudRegistered && desktopOnTailscale;
  const localIdentityLabel =
    tailscaleIdentity?.dnsName ||
    tailscaleIdentity?.hostName ||
    tailscaleIdentity?.ip ||
    tailscaleIdentity?.error ||
    "Checking private network...";
  const installationLabel = !tailscaleKnown
    ? "Checking"
    : tailscaleInstalled
      ? "Installed"
      : "Not installed";
  const registrationFailed = lastExit?.code != null && lastExit.code !== 0;
  const registrationAuthRequired =
    registrationFailed &&
    commandLines.some((line) => line.toLowerCase().includes("login required"));
  const registrationStatus = macRegistrationComplete
    ? "Registered"
    : registrationRunning
      ? "Registering..."
      : registrationFailed
        ? "Registration failed"
        : !macAuthenticated
          ? "Waiting for sign-in"
          : !tailscaleConnected
            ? "Waiting for private network"
            : "Waiting to register";

  return (
    <PageShell
      eyebrow="Step 8"
      heading="Pair your devices privately"
      support="Openbase connects this Mac and your phone through the networking option you selected, then registers their private addresses so they can find each other."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
            <div className="flex items-start justify-between gap-3 px-4 py-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-950">
                  1. Connect this Mac
                </div>
                <div className="mt-1 text-xs leading-5 text-zinc-600">
                  {tailnetProvider === "netmesh"
                    ? "Use the bundled Openbase VPN. It connects through Openbase Netmesh and does not need a Tailscale app or account."
                    : "Use Openbase Direct when this environment cannot install a VPN. It carries Openbase app traffic through an embedded connection."}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-600">
                  <span className="inline-flex items-center gap-1.5">
                    <StatusIcon ok={tailscaleInstalled} />
                    {installationLabel}
                  </span>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <StatusIcon ok={tailscaleConnected} />
                    <span className="truncate">{localIdentityLabel}</span>
                  </span>
                </div>
              </div>
              {tailnetProvider === "netmesh-tsnet" && !tailscaleConnected && (
                <PrimaryButton disabled={networkConnecting} onClick={onConnectNetwork}>
                  {networkConnecting && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
                  Connect Direct
                </PrimaryButton>
              )}
            </div>
            {tailnetProvider === "netmesh" && (
              <div className="px-4 pb-4">
                <NetmeshVpnCard
                  connecting={networkConnecting}
                  onConnect={onConnectNetwork}
                />
              </div>
            )}
            {tailscaleConnected && !tailscalePaired && (
              <div className="px-4 pb-4">
                <PrimaryButton disabled={networkConnecting} onClick={onConnectNetwork}>
                  {networkConnecting && (
                    <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                  )}
                  Retry network registration
                </PrimaryButton>
                <div className="mt-1 text-xs text-zinc-600">
                  Re-applies the selected provider, private routes, and Openbase
                  account registration without rerunning setup.
                </div>
              </div>
            )}
            <div className="px-4 py-4">
              <div className="text-sm font-medium text-zinc-950">
                2. Open Openbase on your iPhone
              </div>
              <div className="mt-1 text-xs leading-5 text-zinc-600">
                The Openbase iOS app walks you through this and registers your
                phone automatically. Come back here when it is connected.
              </div>
            </div>
            <div className="flex items-start justify-between gap-3 px-4 py-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-950">
                  3. Register this Mac automatically
                </div>
                <div className="mt-1 text-xs leading-5 text-zinc-600">
                  Once this Mac is signed in and privately connected, the
                  desktop app shares its private address with Openbase so your
                  phone can find it. Keep this Mac awake while pairing if the
                  laptop lid might close or the display may sleep.
                </div>
                {!macAuthenticated && (
                  <div className="mt-2 text-xs leading-5 text-amber-700">
                    Sign in on this Mac before automatic registration can run.
                  </div>
                )}
              </div>
              <div className="inline-flex h-8 shrink-0 items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-xs font-medium text-zinc-700">
                {registrationRunning ? (
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <StatusIcon ok={macRegistrationComplete} />
                )}
                {registrationStatus}
              </div>
            </div>
          </div>

          {tailscalePaired ? (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              This Mac is registered and both devices are privately paired.
              Continue to verify.
            </div>
          ) : pairingDiagnosticMessages.length > 0 ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="font-medium">Pairing is waiting on:</div>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {pairingDiagnosticMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-600">
              <PulsingDot />
              Waiting for the cloud pairing state to include both devices
            </div>
          )}
          {tailscaleKnown && !tailscaleConnected && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Connect the selected Openbase networking option on this Mac before
              automatic registration can report a private address.
            </div>
          )}
          {!macAuthenticated && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This Mac is not signed in to Openbase Cloud yet. Sign in on this
              Mac, then automatic registration will run so your phone can find it.
            </div>
          )}
          {cloudStateError && !tailscalePaired && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {cloudStateError}
            </div>
          )}
          {registrationAuthRequired && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Registration needs this Mac to be signed in first. Return to Sign
              in, then come back here and automatic registration will retry.
            </div>
          )}
          {registrationFailed && !registrationAuthRequired && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
              Automatic registration exited with code {lastExit?.code ?? "unknown"}.
              Check the output, reconnect the selected private network if needed, then return to
              this step to retry.
            </div>
          )}
          {commandError && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
              {commandError}
            </div>
          )}

          {commandLines.length > 0 && <TerminalOutput lines={commandLines} />}
        </div>

        <aside className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-zinc-950">Pairing state</div>
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
              onClick={onRefreshTailscale}
              title="Refresh local private-network status"
              type="button"
            >
              <RefreshCw aria-hidden className="h-3.5 w-3.5" />
            </button>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Phone signed in</dt>
              <dd className="mt-1 inline-flex items-center gap-1.5 text-zinc-800">
                <StatusIcon ok={mobileAuthenticated} />
                {mobileAuthenticated ? "Linked" : "Not yet"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">This Mac signed in</dt>
              <dd className="mt-1 inline-flex items-center gap-1.5 text-zinc-800">
                <StatusIcon ok={macAuthenticated} />
                {macAuthenticated ? "Signed in" : "Not yet"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">This Mac</dt>
              <dd className="mt-1 min-w-0 text-zinc-800">
                <span className="inline-flex max-w-full items-center gap-1.5">
                  <StatusIcon ok={tailscaleConnected} />
                  <span className="truncate">
                    {tailscaleConnected ? localIdentityLabel : "Not connected"}
                  </span>
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Mac registered</dt>
              <dd className="mt-1 inline-flex items-center gap-1.5 text-zinc-800">
                <StatusIcon ok={desktopCloudRegistered} />
                {desktopCloudRegistered ? "Registered" : "Not yet"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Mac privately connected</dt>
              <dd className="mt-1 inline-flex items-center gap-1.5 text-zinc-800">
                <StatusIcon ok={desktopOnTailscale} />
                {desktopOnTailscale ? "Reported to cloud" : "Waiting"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Phone privately connected</dt>
              <dd className="mt-1 inline-flex items-center gap-1.5 text-zinc-800">
                <StatusIcon ok={mobileOnTailscale} />
                {mobileOnTailscale ? "Reported to cloud" : "Waiting"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Cloud pairing</dt>
              <dd className="mt-1 inline-flex items-center gap-1.5 text-zinc-800">
                <StatusIcon ok={tailscalePaired} />
                {tailscalePaired ? "Paired" : "Not paired"}
              </dd>
            </div>
            {tailscaleIdentity?.tailnet && (
              <div>
                <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Tailnet</dt>
                <dd className="mt-1 break-words text-zinc-800">{tailscaleIdentity.tailnet}</dd>
              </div>
            )}
          </dl>
        </aside>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <PrimaryButton disabled={!tailscalePaired} onClick={onContinue}>
          Continue to verify
          <ArrowRight aria-hidden className="h-4 w-4" />
        </PrimaryButton>
      </div>
    </PageShell>
  );
}
