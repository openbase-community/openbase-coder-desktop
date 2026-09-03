import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { useEffect } from "react";

import { ManualFallback } from "../components/ManualFallback";
import { PageShell } from "../components/PageShell";
import { PrerequisiteAction } from "../components/PrerequisiteAction";
import { PrimaryButton } from "../components/PrimaryButton";
import { StatusIcon } from "../components/StatusIcon";
import { REQUIRED_PREREQUISITE_IDS } from "../config";
import type { InstallerCommand, Prerequisite } from "../types";

export function PrerequisitesPage({
  canRunSetup,
  checkError,
  commandError,
  hasInstaller,
  isCheckingPrerequisites,
  missingPrerequisites,
  missingRequiredPrerequisites,
  onCheckPrerequisites,
  onConnectTailscale,
  onContinue,
  onDownloadTailscale,
  onOpenTailscale,
  onStartCommand,
  prerequisites,
  runningCommand,
  tailscaleConnecting,
  tailscaleError,
}: {
  canRunSetup: boolean;
  checkError: string | null;
  commandError: string | null;
  hasInstaller: boolean;
  isCheckingPrerequisites: boolean;
  missingPrerequisites: Prerequisite[];
  missingRequiredPrerequisites: Prerequisite[];
  onCheckPrerequisites: () => void;
  onConnectTailscale: () => void;
  onContinue: () => void;
  onDownloadTailscale: () => void;
  onOpenTailscale: () => void;
  onStartCommand: (commandId: InstallerCommand) => void;
  prerequisites: Prerequisite[];
  runningCommand: InstallerCommand | null;
  tailscaleConnecting: boolean;
  tailscaleError: string | null;
}) {
  // Re-scan when the window regains focus so installing Tailscale in another
  // app and coming back flips the check without a manual click.
  useEffect(() => {
    window.addEventListener("focus", onCheckPrerequisites);
    return () => window.removeEventListener("focus", onCheckPrerequisites);
  }, [onCheckPrerequisites]);

  return (
    <PageShell
      eyebrow="Step 2"
      heading="Check runtime readiness"
      support="The desktop app activates its bundled Openbase CLI, then checks Tailscale for phone-to-computer voice networking."
    >
      <div className="flex flex-wrap gap-3">
        <PrimaryButton
          disabled={isCheckingPrerequisites}
          onClick={onCheckPrerequisites}
        >
          {isCheckingPrerequisites ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw aria-hidden className="h-4 w-4" />
          )}
          Check prerequisites
        </PrimaryButton>
      </div>

      {checkError && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {checkError}
        </div>
      )}

      {commandError && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {commandError}
        </div>
      )}

      {tailscaleError && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {tailscaleError}
        </div>
      )}

      <div className="mt-5 divide-y divide-zinc-200 rounded-lg border border-zinc-200">
        {prerequisites.length === 0 ? (
          <div className="px-4 py-4 text-sm text-zinc-500">
            {isCheckingPrerequisites
              ? "Checking prerequisites..."
              : "Run the check to inspect this Mac."}
          </div>
        ) : (
          prerequisites.map((item) => (
            <div key={item.id} className="flex gap-3 px-4 py-4">
              <div className="mt-0.5">
                <StatusIcon
                  ok={item.ok}
                  severity={REQUIRED_PREREQUISITE_IDS.includes(item.id) ? "error" : "warn"}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-950">{item.label}</div>
                  <div className="mt-1 break-words text-xs leading-5 text-zinc-600">
                    {item.detail}
                  </div>
                </div>
                <PrerequisiteAction
                  disabled={Boolean(runningCommand) || tailscaleConnecting}
                  item={item}
                  onConnectTailscale={onConnectTailscale}
                  onDownloadTailscale={onDownloadTailscale}
                  onOpenTailscale={onOpenTailscale}
                  onStartCommand={onStartCommand}
                  tailscaleConnecting={tailscaleConnecting}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {(missingPrerequisites.length > 0 || !hasInstaller) && (
        <div className="mt-5">
          <ManualFallback />
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <PrimaryButton disabled={!canRunSetup || isCheckingPrerequisites} onClick={onContinue}>
          Continue to setup
          <ArrowRight aria-hidden className="h-4 w-4" />
        </PrimaryButton>
        {missingRequiredPrerequisites.length > 0 && (
          <div className="flex items-center text-sm text-zinc-600">
            Finish required prerequisites before setup.
          </div>
        )}
      </div>
    </PageShell>
  );
}
