import { Download, Loader2, Play, RefreshCw, Terminal } from "lucide-react";

import { PageShell } from "../components/PageShell";
import { SecondaryButton } from "../components/SecondaryButton";
import { StatusIcon } from "../components/StatusIcon";
import { TerminalOutput } from "../components/TerminalOutput";
import type {
  AudioProviderChoice,
  BackendStatus,
  CliVersions,
  LoginStatus,
  SelectableOption,
  StartCommand,
} from "../types";

export function VerifyPage({
  appVersion,
  backendBaseUrl,
  backendStatusLabel,
  canRunUtilities,
  cliVersions,
  commandError,
  commandLines,
  loggedIn,
  loginStatus,
  onCheckHealth,
  onReviewPrerequisites,
  onStartCommand,
  selectedAudioProvider,
  selectedAudioProviderOption,
  status,
  voiceConfigured,
}: {
  appVersion: string | null;
  backendBaseUrl: string;
  backendStatusLabel: string;
  canRunUtilities: boolean;
  cliVersions: CliVersions | null;
  commandError: string | null;
  commandLines: string[];
  loggedIn: boolean;
  loginStatus: LoginStatus | null;
  onCheckHealth: () => void;
  onReviewPrerequisites: () => void;
  onStartCommand: StartCommand;
  selectedAudioProvider: AudioProviderChoice;
  selectedAudioProviderOption: SelectableOption<AudioProviderChoice>;
  status: BackendStatus;
  voiceConfigured: boolean;
}) {
  const cliUpdateAvailable = Boolean(
    cliVersions?.update_available || cliVersions?.update_required,
  );
  const versionLine = [
    appVersion ? `App v${appVersion}` : null,
    cliVersions?.cli
      ? `CLI v${cliVersions.cli}${
          cliVersions.standalone && cliVersions.channel
            ? ` (${cliVersions.channel})`
            : ""
        }`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <PageShell
      eyebrow="Step 9"
      heading="Verify the backend"
      support="The last step is confirming the local service is healthy and that voice audio and Openbase login are configured."
    >
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-950">
              {status === "checking" ? (
                <Loader2 aria-hidden className="h-4 w-4 animate-spin text-zinc-500" />
              ) : (
                <StatusIcon ok={status === "ready"} />
              )}
              {backendStatusLabel}
            </div>
            <div className="mt-2 break-words font-mono text-xs text-zinc-600">
              {backendBaseUrl}/api/health/
            </div>
            {versionLine && (
              <div className="mt-1 font-mono text-xs text-zinc-500">{versionLine}</div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <SecondaryButton disabled={status === "checking"} onClick={onCheckHealth}>
              <RefreshCw aria-hidden className="h-4 w-4" />
              Recheck
            </SecondaryButton>
            <SecondaryButton
              disabled={!canRunUtilities}
              onClick={() => void onStartCommand("startBackend")}
            >
              <Play aria-hidden className="h-4 w-4" />
              Start backend
            </SecondaryButton>
            <SecondaryButton disabled={!canRunUtilities} onClick={() => void onStartCommand("doctor")}>
              <Terminal aria-hidden className="h-4 w-4" />
              Doctor
            </SecondaryButton>
            <SecondaryButton
              disabled={!canRunUtilities}
              onClick={() => void onStartCommand("selfUpdate")}
            >
              <Download aria-hidden className="h-4 w-4" />
              Update CLI
            </SecondaryButton>
          </div>
        </div>
        {cliUpdateAvailable && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {cliVersions?.update_required
              ? "A CLI update is required before voice sessions can continue."
              : "A CLI update is available."}
            {cliVersions?.cli ? ` Installed version: ${cliVersions.cli}.` : ""}{" "}
            Use Update CLI to apply it.
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {[
          {
            detail: `${backendBaseUrl}/api/health/`,
            label: "Backend health",
            ok: status === "ready",
          },
          {
            detail:
              selectedAudioProvider === "cartesia"
                ? "~/.openbase/.env"
                : selectedAudioProviderOption.label,
            label: "Voice audio",
            ok: voiceConfigured,
          },
          {
            detail: loginStatus?.path ?? "~/.openbase/auth.json",
            label: "Openbase login",
            ok: loggedIn,
          },
        ].map((item) => (
          <div className="rounded-xl border border-zinc-200 bg-white p-4" key={item.label}>
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-950">
              <StatusIcon ok={item.ok} />
              {item.label}
            </div>
            <div className="mt-2 break-words font-mono text-xs leading-5 text-zinc-600">
              {item.detail}
            </div>
          </div>
        ))}
      </div>

      {commandError && (
        <div className="mt-5 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {commandError}
        </div>
      )}

      {commandLines.length > 0 && (
        <div className="mt-5">
          <TerminalOutput lines={commandLines} />
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <SecondaryButton onClick={onReviewPrerequisites}>
          Review prerequisites
        </SecondaryButton>
      </div>
    </PageShell>
  );
}
