import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  CircleHelp,
  Play,
  ShieldAlert,
  Square,
} from "lucide-react";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { OptionCardGrid } from "../components/OptionCardGrid";
import { PageShell } from "../components/PageShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { SecondaryButton } from "../components/SecondaryButton";
import { SetupStepChecklist } from "../components/SetupStepChecklist";
import { TerminalOutput } from "../components/TerminalOutput";
import {
  commandLabel,
  existingMachineBackendOptions,
  NORMAL_ONBOARDING_AUDIO_PROVIDER,
  NORMAL_ONBOARDING_BACKEND,
  setupCommandText,
} from "../config";
import { calmEase } from "../motion";
import type {
  BackendChoice,
  InstallerCommand,
  SetupSteps,
  StartCommand,
} from "../types";

export function SetupPage({
  canRunSetup,
  commandError,
  commandLines,
  canContinue,
  installedBackend,
  lastExit,
  onCancelCommand,
  onContinue,
  onStartCommand,
  runningCommand,
  setSelectedBackend,
  selectedBackend,
  setupSteps,
  setupSucceeded,
}: {
  canContinue: boolean;
  canRunSetup: boolean;
  commandError: string | null;
  commandLines: string[];
  /** The backend this install already uses, per the CLI status payload. */
  installedBackend: BackendChoice | null;
  lastExit: { code: number | null; commandId: InstallerCommand } | null;
  onCancelCommand: () => void;
  onContinue: () => void;
  onStartCommand: StartCommand;
  runningCommand: InstallerCommand | null;
  selectedBackend: BackendChoice;
  setSelectedBackend: Dispatch<SetStateAction<BackendChoice>>;
  setupSteps: SetupSteps;
  setupSucceeded: boolean;
}) {
  const [showSetupWarning, setShowSetupWarning] = useState(false);
  const [showSetupHelp, setShowSetupHelp] = useState(false);
  const [useExistingBackend, setUseExistingBackend] = useState(false);
  const [backendTouched, setBackendTouched] = useState(false);
  // Resume fidelity: reflect the install's configured backend until the
  // user makes their own choice this session.
  useEffect(() => {
    if (backendTouched || !installedBackend) {
      return;
    }
    setUseExistingBackend(installedBackend !== NORMAL_ONBOARDING_BACKEND);
    setSelectedBackend(installedBackend);
  }, [backendTouched, installedBackend, setSelectedBackend]);
  const setupBackend =
    useExistingBackend && selectedBackend !== NORMAL_ONBOARDING_BACKEND
      ? selectedBackend
      : NORMAL_ONBOARDING_BACKEND;
  const setupCommand = setupCommandText(
    setupBackend,
    NORMAL_ONBOARDING_AUDIO_PROVIDER,
    false,
    true,
  );
  const setupHelpAgentCommand = setupBackend === "codex" ? "codex" : "claude";
  const setupHelpPrompt = `We are trying to run \`${setupCommand}\` to install openbase but it is failing. Debug and fix so that the command runs, and then we will return to the app to continue with the login step.`;
  const setupHelpCommand = `cd ~/.openbase && ${setupHelpAgentCommand} ${shellQuote(
    setupHelpPrompt,
  )}`;

  const confirmSetup = () => {
    setShowSetupWarning(false);
    setSelectedBackend(setupBackend);
    void onStartCommand("setup", {
      audioProvider: NORMAL_ONBOARDING_AUDIO_PROVIDER,
      backend: setupBackend,
      fastMode: true,
      linkClaudeConfig: false,
      linkCodexConfig: false,
    });
  };
  const chooseExistingBackend = (enabled: boolean) => {
    setBackendTouched(true);
    setUseExistingBackend(enabled);
    setSelectedBackend(enabled ? "codex" : NORMAL_ONBOARDING_BACKEND);
  };

  return (
    <PageShell
      eyebrow="Step 3"
      heading="Set up Openbase Cloud"
      support="Openbase Cloud is the normal setup path: managed Claude Code and managed voice audio. No provider keys or separate AI subscriptions are needed."
    >
      <div className="mb-5 space-y-5">
        <section>
          <div className="text-sm font-semibold text-zinc-950">
            Do you already use the Codex CLI or Claude Code CLI on this Mac?
          </div>
          <div className="mt-3 inline-flex rounded-xl border border-zinc-200 bg-zinc-50 p-1">
            {[
              { label: "Yes", value: true },
              { label: "No", value: false },
            ].map((option) => {
              const selected = useExistingBackend === option.value;
              return (
                <button
                  aria-pressed={selected}
                  className={`h-9 min-w-20 rounded-lg px-4 text-sm font-medium transition ${
                    selected
                      ? "bg-white text-zinc-950 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-800"
                  } ${runningCommand ? "cursor-not-allowed opacity-60" : ""}`}
                  disabled={Boolean(runningCommand)}
                  key={option.label}
                  onClick={() => chooseExistingBackend(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-600">
            Openbase Cloud manages voice audio either way. If you choose Yes,
            setup imports the CLI&apos;s own sign-in into Openbase&apos;s
            separate agent homes — your Codex CLI login is linked and your
            Claude Code CLI login is copied, leaving your normal CLI setup
            untouched. Desktop app or IDE sign-ins can&apos;t be imported; if
            the CLI isn&apos;t signed in yet, the Agent sign-in step will
            finish it.
          </p>

          {useExistingBackend && (
            <div className="mt-4">
              <div className="text-sm font-medium text-zinc-950">Coding backend</div>
              <OptionCardGrid
                disabled={Boolean(runningCommand)}
                onSelect={(id) => {
                  setBackendTouched(true);
                  setSelectedBackend(id);
                }}
                options={existingMachineBackendOptions}
                selected={setupBackend}
              />
            </div>
          )}
        </section>

        <div className="mt-3 flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
          <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs text-zinc-800">
            {setupCommand}
          </code>
          <button
            aria-label="Setup help"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition hover:border-[#18498B]/30 hover:text-[#18498B]"
            onClick={() => setShowSetupHelp(true)}
            title="Setup help"
            type="button"
          >
            <CircleHelp aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {runningCommand ? (
          <SecondaryButton onClick={onCancelCommand}>
            <Square aria-hidden className="h-4 w-4" />
            Stop command
          </SecondaryButton>
        ) : (
          <PrimaryButton
            disabled={!canRunSetup}
            onClick={() => setShowSetupWarning(true)}
          >
            <Play aria-hidden className="h-4 w-4" />
            Run setup
          </PrimaryButton>
        )}
      </div>

      {commandError && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {commandError}
        </div>
      )}
      {lastExit && lastExit.code !== 0 && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {commandLabel(lastExit.commandId)} exited with code {lastExit.code ?? "unknown"}.
          Setup output remains below for diagnostics.
        </div>
      )}
      {setupSucceeded && (
        <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Setup completed. Continue to sign in to Openbase Cloud.
        </div>
      )}

      <div className="mt-5 space-y-3">
        <SetupStepChecklist steps={setupSteps} />
        <TerminalOutput lines={commandLines} />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <PrimaryButton disabled={!canContinue} onClick={onContinue}>
          Continue
          <ArrowRight aria-hidden className="h-4 w-4" />
        </PrimaryButton>
        {!canContinue && (
          <p className="w-full text-xs text-zinc-500">
            Run setup successfully to continue.
          </p>
        )}
        {canContinue && !setupSucceeded && (
          <p className="w-full text-xs text-zinc-500">
            Your backend is already set up and healthy from a previous run —
            continue, or re-run setup to refresh the Openbase Cloud defaults.
          </p>
        )}
      </div>

      <AnimatePresence>
        {showSetupHelp && (
          <motion.div
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-6"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={() => setShowSetupHelp(false)}
            transition={{ ...calmEase, duration: 0.25 }}
          >
            <motion.div
              animate={{ opacity: 1, scale: 1, y: 0 }}
              aria-labelledby="setup-help-heading"
              aria-modal="true"
              className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl shadow-zinc-900/20"
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              transition={{ ...calmEase, duration: 0.3 }}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
                  <CircleHelp aria-hidden className="h-5 w-5" />
                </div>
                <div>
                  <h3
                    className="text-base font-semibold tracking-tight text-zinc-900"
                    id="setup-help-heading"
                  >
                    Stuck on this step?
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">
                    Enter the following in Terminal:
                  </p>
                </div>
              </div>

              <pre className="mt-4 max-h-56 overflow-x-auto whitespace-pre-wrap rounded-xl border border-zinc-200 bg-zinc-950 px-4 py-3 text-xs leading-5 text-zinc-50">
                <code>{setupHelpCommand}</code>
              </pre>

              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <SecondaryButton onClick={() => setShowSetupHelp(false)}>
                  Close
                </SecondaryButton>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showSetupWarning && (
          <motion.div
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-6"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={() => setShowSetupWarning(false)}
            transition={{ ...calmEase, duration: 0.25 }}
          >
            <motion.div
              animate={{ opacity: 1, scale: 1, y: 0 }}
              aria-labelledby="setup-warning-heading"
              aria-modal="true"
              className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl shadow-zinc-900/20"
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              transition={{ ...calmEase, duration: 0.3 }}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                  <ShieldAlert aria-hidden className="h-5 w-5" />
                </div>
                <div>
                  <h3
                    className="text-base font-semibold tracking-tight text-zinc-900"
                    id="setup-warning-heading"
                  >
                    Before setup runs
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Setup changes agent permissions on this Mac. Please review.
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3 text-sm leading-6 text-zinc-600">
                <p>
                  Setup configures Openbase&apos;s dedicated agent homes
                  (~/.openbase) to run coding agents with{" "}
                  <span className="font-semibold text-zinc-900">
                    all permissions enabled
                  </span>{" "}
                  — no approval prompts, full file and network access — so voice
                  coding can work hands-free.
                </p>
                <p>
                  It also adds the Openbase &ldquo;super-agents&rdquo; MCP server to
                  your normal Codex and Claude Code configs. You can remove those
                  entries later; re-running setup adds them back.
                </p>
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <SecondaryButton onClick={() => setShowSetupWarning(false)}>
                  Cancel
                </SecondaryButton>
                <PrimaryButton onClick={confirmSetup}>
                  <Play aria-hidden className="h-4 w-4" />
                  I understand, run setup
                </PrimaryButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </PageShell>
  );
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
