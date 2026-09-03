import { useCallback, useEffect, useRef, useState } from "react";

import { commandLabel, MAX_TERMINAL_LINES, parseSetupProgressEvent } from "./config";
import type {
  InstallerApi,
  InstallerCommand,
  SetupSteps,
  StartCommandOptions,
} from "./types";

export type InstallerCallbacks = {
  checkHealth: () => Promise<void>;
  checkPrerequisites: () => Promise<void>;
  /** Called when a login command exits (any code). */
  onLoginExit: () => void;
  /** Refetches the CLI status payload (login, agent auth, voice, Tailscale). */
  refreshCliOnboardingStatus: () => Promise<void>;
  refreshCloudState: () => Promise<void>;
};

/**
 * Owns the installer IPC event stream and the state of the currently running
 * setup command: streamed terminal lines, structured setup steps, exit codes
 * and errors.
 */
export function useInstaller(
  installer: InstallerApi | undefined,
  callbacks: InstallerCallbacks,
) {
  const {
    checkHealth,
    checkPrerequisites,
    onLoginExit,
    refreshCliOnboardingStatus,
    refreshCloudState,
  } = callbacks;

  const [runningCommand, setRunningCommand] = useState<InstallerCommand | null>(null);
  const [lastExit, setLastExit] = useState<{ code: number | null; commandId: InstallerCommand } | null>(
    null,
  );
  const [setupCompleted, setSetupCompleted] = useState(false);
  const [commandLines, setCommandLines] = useState<string[]>([]);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [setupSteps, setSetupSteps] = useState<SetupSteps>({});
  const setupResultSeenRef = useRef(false);

  useEffect(() => {
    if (!installer) {
      return undefined;
    }

    return installer.onEvent((event) => {
      if (event.type === "start") {
        setRunningCommand(event.commandId);
        setLastExit(null);
        setCommandError(null);
        if (event.commandId === "setup") {
          setSetupCompleted(false);
          setSetupSteps({});
          setupResultSeenRef.current = false;
        }
        setCommandLines((current) => {
          const next = current.length === 0
            ? [`$ ${event.commandText}`]
            : ["", `# ${commandLabel(event.commandId)}`, `$ ${event.commandText}`];
          return [...current, ...next].slice(-MAX_TERMINAL_LINES);
        });
        return;
      }

      if (event.type === "output") {
        const prefix = event.stream === "stderr" ? "stderr" : "stdout";
        const lines = event.text.split(/\r?\n/).filter(Boolean);
        const terminalLines: string[] = [];
        for (const line of lines) {
          // `setup --json-progress` emits NDJSON step events on stdout;
          // everything human-readable arrives on stderr.
          const progressEvent =
            event.commandId === "setup" && event.stream === "stdout"
              ? parseSetupProgressEvent(line)
              : null;
          if (!progressEvent) {
            terminalLines.push(`[${prefix}] ${line}`);
            continue;
          }
          if (progressEvent.event === "step") {
            const { id, status: stepStatus } = progressEvent;
            const detail = progressEvent.detail ?? null;
            setSetupSteps((current) => ({
              ...current,
              [id]: { detail, status: stepStatus },
            }));
            continue;
          }
          if (progressEvent.event === "result") {
            setupResultSeenRef.current = true;
            const setupOk = Boolean(
              progressEvent.ok &&
                progressEvent.cli_configured,
            );
            setSetupCompleted(setupOk);
            if (!setupOk) {
              setCommandError(
                progressEvent.tailscale_serve_healthy === false
                  ? "Setup installed the local services. Sign in next, then finish connecting Openbase VPN or Openbase Direct during pairing."
                  : "Setup did not complete all required configuration.",
              );
            }
          }
        }
        if (terminalLines.length > 0) {
          setCommandLines((current) =>
            [...current, ...terminalLines].slice(-MAX_TERMINAL_LINES),
          );
        }
        return;
      }

      if (event.type === "error") {
        setRunningCommand(null);
        setCommandError(event.error);
        setCommandLines((current) => [...current, `[error] ${event.error}`].slice(-MAX_TERMINAL_LINES));
        return;
      }

      setRunningCommand(null);
      setLastExit({ code: event.code, commandId: event.commandId });
      setCommandLines((current) => [
        ...current,
        `[exit] ${commandLabel(event.commandId)} finished with code ${event.code ?? "unknown"}`,
      ].slice(-MAX_TERMINAL_LINES));
      if (event.commandId === "login") {
        onLoginExit();
      }
      if (event.commandId === "tailnetSetProvider") {
        // A provider command can connect locally even when account sync fails.
        // Always refresh both sides so the pairing page can show the true state
        // and retain its independently retryable registration action.
        void refreshCliOnboardingStatus();
        void refreshCloudState();
      }
      if (event.code === 0) {
        if (event.commandId === "installCli") {
          void checkPrerequisites();
        }
        if (event.commandId === "setup" && !setupResultSeenRef.current) {
          setSetupCompleted(true);
        }
        if (event.commandId === "setup" || event.commandId === "restartBackend") {
          void refreshCliOnboardingStatus();
        }
        if (event.commandId === "setup" || event.commandId === "onboardingReport") {
          void refreshCloudState();
        }
        window.setTimeout(() => void checkHealth(), 1200);
      }
    });
  }, [
    checkHealth,
    checkPrerequisites,
    installer,
    onLoginExit,
    refreshCliOnboardingStatus,
    refreshCloudState,
  ]);

  const startCommand = useCallback(
    async (commandId: InstallerCommand, options?: StartCommandOptions) => {
      if (!installer || runningCommand) {
        return;
      }

      setCommandError(null);
      try {
        const result = await installer.start(commandId, options);
        if (!result.ok) {
          setCommandError(result.error || "Could not start setup command.");
        }
      } catch (error) {
        setCommandError(
          error instanceof Error ? error.message : "Could not start setup command.",
        );
      }
    },
    [installer, runningCommand],
  );

  const cancelCommand = useCallback(async () => {
    if (!installer) {
      return;
    }
    await installer.cancel();
  }, [installer]);

  return {
    cancelCommand,
    commandError,
    commandLines,
    lastExit,
    runningCommand,
    setupCompleted,
    setupSteps,
    startCommand,
  };
}
