import { ArrowRight, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

import { PageShell } from "../components/PageShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { StatusIcon } from "../components/StatusIcon";
import { TerminalOutput } from "../components/TerminalOutput";
import { PulsingDot } from "../motion";
import type { InstallerCommand, TailscaleIdentityStatus } from "../types";

export function LinuxPairingPage({
  cloudStateError,
  commandError,
  commandLines,
  desktopCloudRegistered,
  desktopOnTailscale,
  lastExit,
  linuxTailscaleConnecting,
  linuxTailscaleError,
  localAuthenticated,
  mobileAuthenticated,
  mobileOnTailscale,
  onConnectTailscale,
  onContinue,
  onRefreshTailscale,
  pairingDiagnosticMessages,
  registrationRunning,
  tailscaleIdentity,
  tailscalePaired,
}: {
  cloudStateError: string | null;
  commandError: string | null;
  commandLines: string[];
  desktopCloudRegistered: boolean;
  desktopOnTailscale: boolean;
  lastExit: { code: number | null; commandId: InstallerCommand } | null;
  linuxTailscaleConnecting: boolean;
  linuxTailscaleError: string | null;
  localAuthenticated: boolean;
  mobileAuthenticated: boolean;
  mobileOnTailscale: boolean;
  onConnectTailscale: () => void;
  onContinue: () => void;
  onRefreshTailscale: () => void;
  pairingDiagnosticMessages: string[];
  registrationRunning: boolean;
  tailscaleIdentity: TailscaleIdentityStatus | null;
  tailscalePaired: boolean;
}) {
  const tailscaleConnected = tailscaleIdentity?.connected === true;
  const workspaceRegistrationComplete = desktopCloudRegistered && desktopOnTailscale;
  const localIdentityLabel =
    tailscaleIdentity?.dnsName ||
    tailscaleIdentity?.hostName ||
    tailscaleIdentity?.ip ||
    tailscaleIdentity?.error ||
    "Checking Tailscale...";
  const registrationFailed = lastExit?.code != null && lastExit.code !== 0;
  const registrationStatus = workspaceRegistrationComplete
    ? "Registered"
    : registrationRunning
      ? "Registering..."
      : registrationFailed
        ? "Registration failed"
        : !localAuthenticated
          ? "Waiting for sign-in"
          : !tailscaleConnected
            ? "Waiting for Tailscale"
            : "Waiting to register";

  return (
    <PageShell
      eyebrow="Step 8"
      heading="Connect your workspace over Tailscale"
      support="The desktop app joins this Linux workspace to your tailnet, enables Tailscale SSH, and registers its private address with Openbase. You will authenticate directly with Tailscale in the browser."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
            <div className="flex items-start justify-between gap-3 px-4 py-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-950">
                  1. Join this workspace to your tailnet
                </div>
                <div className="mt-1 text-xs leading-5 text-zinc-600">
                  Openbase starts the system Tailscale client and opens its secure
                  sign-in page. Sign in to the same tailnet as your phone and other
                  devices. No Tailscale credential is shared with Openbase.
                </div>
                <div className="mt-2 inline-flex min-w-0 items-center gap-1.5 text-xs text-zinc-600">
                  <StatusIcon ok={tailscaleConnected} />
                  <span className="truncate">
                    {tailscaleConnected ? localIdentityLabel : "Not connected"}
                  </span>
                </div>
              </div>
              <button
                className="inline-flex h-8 shrink-0 items-center gap-2 rounded-xl bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={linuxTailscaleConnecting}
                onClick={onConnectTailscale}
                type="button"
              >
                {linuxTailscaleConnecting ? (
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
                )}
                {linuxTailscaleConnecting
                  ? "Waiting for sign-in..."
                  : tailscaleConnected
                    ? "Ensure SSH is enabled"
                    : "Connect Tailscale"}
              </button>
            </div>

            <div className="px-4 py-4">
              <div className="text-sm font-medium text-zinc-950">
                2. Connect your iPhone to the same tailnet
              </div>
              <div className="mt-1 text-xs leading-5 text-zinc-600">
                The Openbase iOS app registers your phone automatically. This
                workspace and the phone remain isolated from other users' tailnets.
              </div>
            </div>

            <div className="flex items-start justify-between gap-3 px-4 py-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-950">
                  3. Register this workspace automatically
                </div>
                <div className="mt-1 text-xs leading-5 text-zinc-600">
                  After Tailscale connects, the app reports this workspace's private
                  Tailscale identity to your Openbase account.
                </div>
              </div>
              <div className="inline-flex h-8 shrink-0 items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-xs font-medium text-zinc-700">
                {registrationRunning ? (
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <StatusIcon ok={workspaceRegistrationComplete} />
                )}
                {registrationStatus}
              </div>
            </div>
          </div>

          {linuxTailscaleConnecting && (
            <div className="flex items-center gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm text-blue-900">
              <PulsingDot />
              Finish signing in on the Tailscale browser page. This window will
              update automatically.
            </div>
          )}
          {linuxTailscaleError && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
              {linuxTailscaleError}
            </div>
          )}
          {tailscalePaired ? (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              This workspace is registered and both devices are paired over Tailscale.
              Tailscale SSH is enabled for connections allowed by your tailnet policy.
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
          {cloudStateError && !tailscalePaired && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {cloudStateError}
            </div>
          )}
          {registrationFailed && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
              Automatic workspace registration exited with code {lastExit?.code ?? "unknown"}.
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
            <div className="text-sm font-medium text-zinc-950">Workspace state</div>
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
              onClick={onRefreshTailscale}
              title="Refresh local Tailscale status"
              type="button"
            >
              <RefreshCw aria-hidden className="h-3.5 w-3.5" />
            </button>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            {[
              ["Workspace signed in", localAuthenticated, localAuthenticated ? "Signed in" : "Not yet"],
              ["Phone signed in", mobileAuthenticated, mobileAuthenticated ? "Linked" : "Not yet"],
              ["Workspace registered", desktopCloudRegistered, desktopCloudRegistered ? "Registered" : "Not yet"],
              ["Workspace on Tailscale", desktopOnTailscale, desktopOnTailscale ? "Reported to cloud" : "Waiting"],
              ["Phone on Tailscale", mobileOnTailscale, mobileOnTailscale ? "Reported to cloud" : "Waiting"],
              ["Cloud pairing", tailscalePaired, tailscalePaired ? "Paired" : "Not paired"],
            ].map(([label, ok, value]) => (
              <div key={String(label)}>
                <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">{label}</dt>
                <dd className="mt-1 inline-flex items-center gap-1.5 text-zinc-800">
                  <StatusIcon ok={Boolean(ok)} />
                  {value}
                </dd>
              </div>
            ))}
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
