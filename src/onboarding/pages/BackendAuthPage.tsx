import { ArrowRight, KeyRound, RefreshCw, Square } from "lucide-react";

import { AdvancedDetails } from "../components/AdvancedDetails";
import { PageShell } from "../components/PageShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { SecondaryButton } from "../components/SecondaryButton";
import { StatusIcon } from "../components/StatusIcon";
import { TerminalOutput } from "../components/TerminalOutput";
import type { BackendAuthStatus, InstallerCommand, StartCommand } from "../types";

const BACKEND_LABELS: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  openbase_cloud: "Openbase Cloud",
};

export function backendAuthLabel(backendAuth: BackendAuthStatus | null): string {
  if (!backendAuth) {
    return "coding agent";
  }
  return BACKEND_LABELS[backendAuth.backend] ?? backendAuth.backend;
}

/**
 * Sign in to the coding backend chosen during setup. Direct Claude Code sign-in
 * runs through the installer bridge. Openbase Cloud uses the Openbase account
 * login on the next step.
 */
export function BackendAuthPage({
  backendAuth,
  backendAuthReady,
  canRunUtilities,
  commandError,
  commandLines,
  onCancelCommand,
  onContinue,
  onRecheck,
  onStartCommand,
  runningCommand,
}: {
  backendAuth: BackendAuthStatus | null;
  backendAuthReady: boolean;
  canRunUtilities: boolean;
  commandError: string | null;
  commandLines: string[];
  onCancelCommand: () => void;
  onContinue: () => void;
  onRecheck: () => void;
  onStartCommand: StartCommand;
  runningCommand: InstallerCommand | null;
}) {
  const backend = backendAuth?.backend ?? null;
  const label = backendAuthLabel(backendAuth);

  return (
    <PageShell
      eyebrow="Bring your own agent"
      heading={`Sign in to ${label}`}
      support={`Openbase runs coding sessions through ${label}, which needs its own sign-in. This page updates automatically once you finish.`}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {(backend === "claude_code" || backend === "codex") && (
            <div className="flex flex-wrap gap-3">
              {runningCommand === (backend === "codex" ? "codexLogin" : "claudeLogin") ? (
                <SecondaryButton onClick={onCancelCommand}>
                  <Square aria-hidden className="h-4 w-4" />
                  Stop sign-in
                </SecondaryButton>
              ) : (
                <PrimaryButton
                  disabled={!canRunUtilities}
                  onClick={() =>
                    void onStartCommand(backend === "codex" ? "codexLogin" : "claudeLogin")
                  }
                >
                  <KeyRound aria-hidden className="h-4 w-4" />
                  Sign in to {label}
                </PrimaryButton>
              )}
              <SecondaryButton onClick={onRecheck}>
                <RefreshCw aria-hidden className="h-4 w-4" />
                Recheck status
              </SecondaryButton>
            </div>
          )}

          {backend !== "claude_code" && backend !== "codex" && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
              {backend === "openbase_cloud"
                ? "Openbase Cloud uses your Openbase account for Cloud-proxied Claude Code. No Anthropic login is required."
                : "Waiting for the local backend to report which coding agent needs a sign-in."}
            </div>
          )}

          {commandError && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
              {commandError}
            </div>
          )}
          {backendAuthReady && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {label} is signed in. Continue to your Openbase account.
            </div>
          )}

          <AdvancedDetails>
            {(backend === "claude_code" || backend === "codex") && (
              <div className="text-xs leading-5 text-zinc-600">
                Manual sign-in command:{" "}
                <code className="font-mono">
                  {backend === "codex" ? "codex login" : "openbase-coder claude login"}
                </code>
              </div>
            )}
            {commandLines.length > 0 && <TerminalOutput lines={commandLines} />}
          </AdvancedDetails>
        </div>

        <aside className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="text-sm font-medium text-zinc-950">Agent sign-in state</div>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                Coding agent
              </dt>
              <dd className="mt-1 text-zinc-800">{label}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Status</dt>
              <dd className="mt-1 inline-flex items-center gap-1.5 text-zinc-800">
                <StatusIcon ok={backendAuthReady} />
                {backendAuthReady ? "Signed in" : "Not signed in"}
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <PrimaryButton disabled={!backendAuthReady} onClick={onContinue}>
          Continue to Openbase sign in
          <ArrowRight aria-hidden className="h-4 w-4" />
        </PrimaryButton>
      </div>
    </PageShell>
  );
}
