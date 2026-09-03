import { ArrowRight, ExternalLink, Loader2, RefreshCw } from "lucide-react";

import { PageShell } from "../components/PageShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { StatusIcon } from "../components/StatusIcon";
import { TerminalOutput } from "../components/TerminalOutput";
import { PulsingDot } from "../motion";
import type { InstallerCommand, TailscaleIdentityStatus } from "../types";

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
  onContinue,
  onOpenTailscale,
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
  macAuthenticated: boolean;
  mobileAuthenticated: boolean;
  mobileOnTailscale: boolean;
  onContinue: () => void;
  onOpenTailscale: () => void;
  onRefreshTailscale: () => void;
  pairingDiagnosticMessages: string[];
  registrationRunning: boolean;
  tailscaleIdentity: TailscaleIdentityStatus | null;
  tailscalePaired: boolean;
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
    "Checking Tailscale...";
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
            ? "Waiting for Tailscale"
            : "Waiting to register";

  return (
    <PageShell
      eyebrow="Step 8"
      heading="Pair your devices over Tailscale"
      support="Tailscale connects your phone and this Mac privately. Sign in to the same tailnet on both devices, then register this Mac so your phone can find it."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
            <div className="flex items-start justify-between gap-3 px-4 py-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-950">
                  1. Install Tailscale on this Mac
                </div>
                <div className="mt-1 text-xs leading-5 text-zinc-600">
                  Open Tailscale, or install it if it is not on this Mac yet,
                  and sign in with the same tailnet you use on your phone.
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
              <button
                className="inline-flex h-8 shrink-0 items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
                onClick={onOpenTailscale}
                type="button"
              >
                <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                Open Tailscale
              </button>
            </div>
            <div className="px-4 py-4">
              <div className="text-sm font-medium text-zinc-950">
                2. Install Tailscale on your iPhone
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
                  Once this Mac is signed in and connected to Tailscale, the
                  desktop app shares its Tailscale address with Openbase so your
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
              This Mac is registered and both devices are paired over Tailscale.
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
              Connect Tailscale on this Mac before automatic registration can
              report a real Tailscale address.
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
              Check the output, reconnect Tailscale if needed, then return to
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
              title="Refresh local Tailscale status"
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
              <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Mac on Tailscale</dt>
              <dd className="mt-1 inline-flex items-center gap-1.5 text-zinc-800">
                <StatusIcon ok={desktopOnTailscale} />
                {desktopOnTailscale ? "Reported to cloud" : "Waiting"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Phone on Tailscale</dt>
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
