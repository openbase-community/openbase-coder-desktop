import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect } from "react";

import { ManualFallback } from "../components/ManualFallback";
import { PageShell } from "../components/PageShell";
import { PrerequisiteAction } from "../components/PrerequisiteAction";
import { PrimaryButton } from "../components/PrimaryButton";
import { StatusIcon } from "../components/StatusIcon";
import { REQUIRED_PREREQUISITE_IDS } from "../config";
import type { TailnetProvider } from "../tailscaleConnectionPrerequisite";
import type { InstallerCommand, Prerequisite, TailnetExperience } from "../types";

export function PrerequisitesPage({
  canRunSetup,
  checkError,
  commandError,
  hasInstaller,
  isCheckingPrerequisites,
  missingPrerequisites,
  missingRequiredPrerequisites,
  onCheckPrerequisites,
  onChooseTailnetProvider,
  onConnectTailscale,
  onContinue,
  onDownloadTailscale,
  onOpenTailscale,
  onRefreshTailnetOptions,
  onStartCommand,
  platform,
  prerequisites,
  runningCommand,
  tailnetProvider,
  tailnetOptions,
  tailnetOptionsError,
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
  onChooseTailnetProvider: (provider: TailnetProvider) => void;
  onConnectTailscale: () => void;
  onContinue: () => void;
  onDownloadTailscale: () => void;
  onOpenTailscale: () => void;
  onRefreshTailnetOptions: () => void;
  onStartCommand: (commandId: InstallerCommand) => void;
  platform: string | undefined;
  prerequisites: Prerequisite[];
  runningCommand: InstallerCommand | null;
  tailnetProvider: TailnetProvider;
  tailnetOptions: TailnetExperience[];
  tailnetOptionsError: string | null;
  tailscaleConnecting: boolean;
  tailscaleError: string | null;
}) {
  const refreshPrerequisites = useCallback(() => {
    onCheckPrerequisites();
    onRefreshTailnetOptions();
  }, [onCheckPrerequisites, onRefreshTailnetOptions]);

  // Re-scan both the runtime and the CLI-owned networking catalog on focus.
  useEffect(() => {
    window.addEventListener("focus", refreshPrerequisites);
    return () => window.removeEventListener("focus", refreshPrerequisites);
  }, [refreshPrerequisites]);

  // Electron offers only the Openbase-owned experiences. Their names and
  // capability copy come from the CLI onboarding contract.
  const privateNetworkPrerequisite = prerequisites.find(
    (item) => item.id === "private-network",
  );
  const showConnectionChoice = privateNetworkPrerequisite !== undefined;
  const commandBusy = Boolean(runningCommand) || tailscaleConnecting;

  return (
    <PageShell
      eyebrow="Step 2"
      heading="Check runtime readiness"
      support="The desktop app activates its bundled Openbase CLI, then configures private phone-to-computer networking."
    >
      <div className="flex flex-wrap gap-3">
        <PrimaryButton
          disabled={isCheckingPrerequisites}
          onClick={refreshPrerequisites}
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

      {showConnectionChoice && (
        <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4">
          <div className="text-sm font-medium text-zinc-950">
            Can this environment support a VPN?
          </div>
          <div className="mt-1 text-xs leading-5 text-zinc-600">
            Choose the VPN for full feature access, including opening websites
            your agents create in a phone browser. Choose Direct only when a
            managed or restricted environment cannot install a VPN.
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {tailnetOptions.map((option) => {
              const selected = tailnetProvider === option.provider;
              return (
                <button
                  aria-pressed={selected}
                  className={`rounded-xl border p-4 text-left transition ${
                    selected
                      ? "border-[#18498B] bg-blue-50"
                      : "border-zinc-200 bg-white hover:border-zinc-300"
                  }`}
                  disabled={commandBusy}
                  key={option.provider}
                  onClick={() => onChooseTailnetProvider(option.provider)}
                  type="button"
                >
                  <div className="text-sm font-semibold text-zinc-950">
                    {option.requires_vpn ? "Yes — " : "No — "}
                    {option.name}
                    {option.recommended ? " (recommended)" : ""}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-zinc-600">
                    {option.summary}
                  </div>
                </button>
              );
            })}
          </div>
          {tailnetOptions.length === 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-amber-700">
              <span>
                {tailnetOptionsError ||
                  "Loading networking choices from the Openbase CLI…"}
              </span>
              {tailnetOptionsError && (
                <button
                  className="font-medium underline underline-offset-2"
                  onClick={onRefreshTailnetOptions}
                  type="button"
                >
                  Retry networking choices
                </button>
              )}
            </div>
          )}
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
