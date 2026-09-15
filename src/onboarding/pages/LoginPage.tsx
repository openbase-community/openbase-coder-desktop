import { ArrowRight, LogIn, RefreshCw, Square } from "lucide-react";

import { AdvancedDetails } from "../components/AdvancedDetails";
import { PageShell } from "../components/PageShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { SecondaryButton } from "../components/SecondaryButton";
import { StatusIcon } from "../components/StatusIcon";
import { TerminalOutput } from "../components/TerminalOutput";
import type { InstallerCommand, LoginStatus, StartCommand } from "../types";

export function LoginPage({
  canRunUtilities,
  commandError,
  commandLines,
  loggedIn,
  loginAttempts,
  loginStatus,
  onCancelCommand,
  onContinue,
  onRefreshLoginStatus,
  onStartCommand,
  runningCommand,
}: {
  canRunUtilities: boolean;
  commandError: string | null;
  commandLines: string[];
  loggedIn: boolean;
  loginAttempts: number;
  loginStatus: LoginStatus | null;
  onCancelCommand: () => void;
  onContinue: () => void;
  onRefreshLoginStatus: () => void;
  onStartCommand: StartCommand;
  runningCommand: InstallerCommand | null;
}) {
  return (
    <PageShell
      eyebrow="Openbase account"
      heading="Sign in to Openbase"
      support="This one Openbase account links your Mac and phone and provides cloud voice audio. If you chose Openbase Cloud for coding, the same sign-in also activates your managed coding agent."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {runningCommand === "login" ? (
              <SecondaryButton onClick={onCancelCommand}>
                <Square aria-hidden className="h-4 w-4" />
                Stop login
              </SecondaryButton>
            ) : (
              <PrimaryButton
                disabled={!canRunUtilities}
                onClick={() => void onStartCommand("login")}
              >
                <LogIn aria-hidden className="h-4 w-4" />
                {loginAttempts === 0 ? "Sign in" : "Sign in again"}
              </PrimaryButton>
            )}
            <SecondaryButton onClick={onRefreshLoginStatus}>
              <RefreshCw aria-hidden className="h-4 w-4" />
              Recheck status
            </SecondaryButton>
          </div>

          {commandError && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
              {commandError}
            </div>
          )}
          {loginAttempts === 1 && !loggedIn && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              Login has not finished yet. Complete the browser sign-in, then recheck status.
            </div>
          )}
          {loginStatus?.status === "login_expired" && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Your Openbase Cloud login expired or was revoked. Run login again to
              reconnect this Mac.
            </div>
          )}
          {loggedIn && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Signed in. Continue to link your phone.
            </div>
          )}

          <AdvancedDetails>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                  Authentication file
                </dt>
                <dd className="mt-1 break-words font-mono text-xs text-zinc-800">
                  {loginStatus?.path ?? "~/.openbase/auth.json"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                  Sign-in attempts
                </dt>
                <dd className="mt-1 text-zinc-800">{loginAttempts}</dd>
              </div>
            </dl>
            {commandLines.length > 0 && <TerminalOutput lines={commandLines} />}
          </AdvancedDetails>
        </div>

        <aside className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="text-sm font-medium text-zinc-950">Sign-in state</div>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Status</dt>
              <dd className="mt-1 inline-flex items-center gap-1.5 text-zinc-800">
                <StatusIcon ok={loggedIn} />
                {loggedIn
                  ? "Signed in"
                  : loginStatus?.status === "login_expired"
                    ? "Login expired"
                    : "Not signed in"}
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <PrimaryButton disabled={!loggedIn} onClick={onContinue}>
          Continue to phone link
          <ArrowRight aria-hidden className="h-4 w-4" />
        </PrimaryButton>
      </div>
    </PageShell>
  );
}
