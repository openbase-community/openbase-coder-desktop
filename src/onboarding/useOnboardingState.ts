import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  identityFromTailscaleSelf,
  parseCliOnboardingStatus,
  type CliOnboardingStatus,
} from "./cliStatus";
import {
  FORCE_ONBOARDING_STORAGE_KEY,
  LINUX_ONBOARDING_COMPLETED_FLAG,
  PAIRING_ACKNOWLEDGED_FLAG,
  TAILSCALE_MAC_APP_STORE_URL,
} from "./config";
import type {
  BackendStatus,
  CliTailscaleSelf,
  CloudOnboardingState,
  InstallerApi,
  Prerequisite,
  VoiceKeyName,
} from "./types";

/**
 * Owns the onboarding facts and how they are fetched. The CLI is the single
 * implementation of every status check; this hook reaches it over two
 * chained paths — GET /api/onboarding/status/ once the backend is healthy,
 * and the CLI binary via the installer bridge before services run — plus
 * the durable acknowledgement flags stored with the installation in
 * ~/.openbase/desktop-onboarding.json.
 */
export function useOnboardingState(
  installer: InstallerApi | undefined,
  backendBaseUrl: string,
) {
  const [status, setStatus] = useState<BackendStatus>("checking");
  // True while a health fetch is in flight. Kept separate from status so
  // rechecks (window focus, Recheck button) revalidate against the last
  // settled answer instead of resetting to "checking" — a reset would flip
  // derived onboarding completion and unmount the console.
  const [healthChecking, setHealthChecking] = useState(false);
  // Parsed GET /api/onboarding/status/ facts; null until the first answer.
  const [cliStatus, setCliStatus] = useState<CliOnboardingStatus | null>(null);
  // True once the status fetch settled at least once, so the launch gate
  // can wait for the first backend-auth/voice answer.
  const [cliStatusChecked, setCliStatusChecked] = useState(false);
  const [prerequisites, setPrerequisites] = useState<Prerequisite[]>([]);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [isCheckingPrerequisites, setIsCheckingPrerequisites] = useState(false);
  const prerequisitesCheckInFlight = useRef(false);
  const [voiceKeyError, setVoiceKeyError] = useState<string | null>(null);
  const [voiceKeyInputs, setVoiceKeyInputs] = useState<Record<VoiceKeyName, string>>({
    ASSEMBLY_AI_API_KEY: "",
    CARTESIA_API_KEY: "",
  });
  const [voiceKeysSaving, setVoiceKeysSaving] = useState(false);
  const [voiceKeysJustSaved, setVoiceKeysJustSaved] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [cloudState, setCloudState] = useState<CloudOnboardingState | null>(null);
  const [cloudStateError, setCloudStateError] = useState<string | null>(null);
  // tailscale_self read via the CLI binary while the backend is down.
  const [ipcTailscaleSelf, setIpcTailscaleSelf] = useState<CliTailscaleSelf | null>(null);
  const [welcomeAcknowledged, setWelcomeAcknowledged] = useState(false);
  // Durable pairing acknowledgement from ~/.openbase/desktop-onboarding.json;
  // null until the first read resolves.
  const [onboardingFlags, setOnboardingFlags] = useState<Record<string, unknown> | null>(null);
  const [forceOnboarding] = useState(
    () => window.localStorage.getItem(FORCE_ONBOARDING_STORAGE_KEY) === "1",
  );

  useEffect(() => {
    let cancelled = false;
    if (!installer?.onboardingFlags) {
      setOnboardingFlags({});
      return undefined;
    }
    installer
      .onboardingFlags()
      .then((flags) => {
        if (!cancelled) {
          setOnboardingFlags(flags && typeof flags === "object" ? flags : {});
        }
      })
      .catch(() => {
        // Treat an unreadable flags file as a fresh installation.
        if (!cancelled) {
          setOnboardingFlags({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [installer]);

  const setOnboardingFlag = useCallback(
    (key: string, value: unknown) => {
      setOnboardingFlags((current) => ({ ...(current ?? {}), [key]: value }));
      void installer?.setOnboardingFlag(key, value);
    },
    [installer],
  );

  const flagsLoaded = onboardingFlags !== null;
  const linuxOnboardingCompleted =
    onboardingFlags?.[LINUX_ONBOARDING_COMPLETED_FLAG] === true;
  const pairingAcknowledged = onboardingFlags?.[PAIRING_ACKNOWLEDGED_FLAG] === true;

  const acknowledgeWelcome = useCallback(() => {
    setWelcomeAcknowledged(true);
  }, []);

  const acknowledgePairing = useCallback(() => {
    setOnboardingFlag(PAIRING_ACKNOWLEDGED_FLAG, true);
  }, [setOnboardingFlag]);

  const acknowledgeLinuxOnboardingComplete = useCallback(() => {
    setOnboardingFlag(LINUX_ONBOARDING_COMPLETED_FLAG, true);
  }, [setOnboardingFlag]);

  const refreshCliOnboardingStatus = useCallback(async () => {
    try {
      const response = await fetch(`${backendBaseUrl}/api/onboarding/status/`);
      if (!response.ok) {
        return;
      }
      setCliStatus(parseCliOnboardingStatus(await response.json()));
    } catch {
      // Backend unreachable; keep the last known facts.
    } finally {
      setCliStatusChecked(true);
    }
  }, [backendBaseUrl]);

  const checkHealth = useCallback(async () => {
    // Stale-while-revalidate: status keeps its last settled value while the
    // fetch runs ("checking" exists only before the first answer), so a
    // recheck can never transiently un-derive onboarding completion.
    setHealthChecking(true);
    try {
      const response = await fetch(`${backendBaseUrl}/api/health/`);
      setStatus(response.ok ? "ready" : "unavailable");
      if (response.ok) {
        void refreshCliOnboardingStatus();
      }
    } catch {
      setStatus("unavailable");
    } finally {
      setHealthChecking(false);
    }
  }, [backendBaseUrl, refreshCliOnboardingStatus]);

  const checkPrerequisites = useCallback(async () => {
    if (!installer) {
      setCheckError(
        "The Electron installer bridge did not load. Restart the desktop app, or rebuild it if this is a local development build.",
      );
      return;
    }
    // The scan is triggered from launch, window focus, and a manual button;
    // never let those overlap into concurrent installer.check() runs.
    if (prerequisitesCheckInFlight.current) {
      return;
    }
    prerequisitesCheckInFlight.current = true;

    setIsCheckingPrerequisites(true);
    setCheckError(null);
    try {
      const result = await installer.check();
      setPrerequisites(result.prerequisites);
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : "Could not check prerequisites.");
    } finally {
      prerequisitesCheckInFlight.current = false;
      setIsCheckingPrerequisites(false);
    }
  }, [installer]);

  const refreshCloudState = useCallback(async () => {
    // Live pairing facts from the cloud registry, proxied by the CLI
    // (GET /api/onboarding/cloud-state/) — never a cached snapshot.
    try {
      const response = await fetch(`${backendBaseUrl}/api/onboarding/cloud-state/`);
      if (response.status === 404 || response.status === 405) {
        setCloudStateError(
          "This Openbase CLI does not report live cloud pairing state yet. Update the CLI, then recheck.",
        );
        return;
      }
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          payload &&
          typeof payload === "object" &&
          typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : `HTTP ${response.status} reading cloud pairing state.`;
        setCloudStateError(detail);
        return;
      }
      if (payload && typeof payload === "object") {
        setCloudState(payload as CloudOnboardingState);
        setCloudStateError(null);
      }
    } catch (error) {
      setCloudStateError(
        error instanceof Error ? error.message : "Could not check cloud onboarding state.",
      );
    }
  }, [backendBaseUrl]);

  const refreshTailscaleIdentity = useCallback(async () => {
    // One implementation (the CLI's tailscale_self check), two access
    // paths: the HTTP status payload when the backend is healthy, or the
    // CLI binary through the installer bridge before services run.
    if (status === "ready") {
      await refreshCliOnboardingStatus();
      return;
    }
    if (!installer?.tailscaleIdentity) {
      return;
    }
    try {
      const result = await installer.tailscaleIdentity();
      setIpcTailscaleSelf(
        result.self ??
          ({
            available: false,
            error: result.error ?? "Tailscale identity is unavailable.",
          } satisfies CliTailscaleSelf),
      );
    } catch (error) {
      setIpcTailscaleSelf({
        available: false,
        error: error instanceof Error ? error.message : "Could not check Tailscale status.",
      });
    }
  }, [installer, refreshCliOnboardingStatus, status]);

  const registerLoginAttempt = useCallback(() => {
    setLoginAttempts((current) => current + 1);
    void refreshCliOnboardingStatus();
  }, [refreshCliOnboardingStatus]);

  const openTailscaleDownload = useCallback(async () => {
    if (!installer) {
      window.open(TAILSCALE_MAC_APP_STORE_URL, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const result = await installer.openTailscaleDownload();
      if (result.ok) {
        return;
      }
    } catch {
      // Fall through to the browser fallback below.
    }
    window.open(TAILSCALE_MAC_APP_STORE_URL, "_blank", "noopener,noreferrer");
  }, [installer]);

  const openTailscaleApp = useCallback(async () => {
    if (!installer?.openTailscaleApp) {
      window.open(TAILSCALE_MAC_APP_STORE_URL, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const result = await installer.openTailscaleApp();
      if (result.ok) {
        return;
      }
    } catch {
      // Fall through to the browser fallback below.
    }
    window.open(TAILSCALE_MAC_APP_STORE_URL, "_blank", "noopener,noreferrer");
  }, [installer]);

  const audio = cliStatus?.audio ?? null;

  const saveVoiceKeys = useCallback(async () => {
    const trimmedAssembly = voiceKeyInputs.ASSEMBLY_AI_API_KEY.trim();
    const trimmedCartesia = voiceKeyInputs.CARTESIA_API_KEY.trim();
    const payload: Partial<Record<VoiceKeyName, string>> = {};
    if (trimmedAssembly) payload.ASSEMBLY_AI_API_KEY = trimmedAssembly;
    if (trimmedCartesia) payload.CARTESIA_API_KEY = trimmedCartesia;

    const existingAssembly = audio?.keys.ASSEMBLY_AI_API_KEY ?? false;
    const existingCartesia = audio?.keys.CARTESIA_API_KEY ?? false;
    if (!trimmedAssembly && !existingAssembly) {
      setVoiceKeyError("Add an Assembly AI API key before saving.");
      return;
    }
    if (!trimmedCartesia && !existingCartesia) {
      setVoiceKeyError("Add a Cartesia API key before saving.");
      return;
    }
    if (Object.keys(payload).length === 0) {
      setVoiceKeyError("Enter at least one new key to update.");
      return;
    }

    setVoiceKeysSaving(true);
    setVoiceKeyError(null);
    setVoiceKeysJustSaved(false);
    try {
      // The CLI owns the env file; write through its settings API rather
      // than a second env-file writer in the desktop app.
      const response = await fetch(`${backendBaseUrl}/api/settings/env/`, {
        body: JSON.stringify({
          entries: Object.entries(payload).map(([key, value]) => ({ key, value })),
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      if (!response.ok) {
        setVoiceKeyError(`Could not save voice keys (HTTP ${response.status}).`);
        return;
      }
      setVoiceKeyInputs({ ASSEMBLY_AI_API_KEY: "", CARTESIA_API_KEY: "" });
      setVoiceKeysJustSaved(true);
      await refreshCliOnboardingStatus();
    } catch (error) {
      setVoiceKeyError(
        error instanceof Error ? error.message : "Could not save voice keys.",
      );
    } finally {
      setVoiceKeysSaving(false);
    }
  }, [audio, backendBaseUrl, refreshCliOnboardingStatus, voiceKeyInputs]);

  useEffect(() => {
    void checkHealth();
    void checkPrerequisites();
    // The Tailscale connection gates the tailscale prerequisite on
    // macOS/Linux, so a configured machine can only derive "complete" at
    // launch if the identity is fetched here, not just on the pages that
    // poll it.
    void refreshTailscaleIdentity();
    // The initial effect runs once; refreshTailscaleIdentity's identity
    // changes with backend status, which must not re-trigger launch probes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkHealth, checkPrerequisites]);

  useEffect(() => {
    if (status === "unavailable") {
      void checkPrerequisites();
    }
  }, [checkPrerequisites, status]);

  const tailscaleSelf =
    status === "ready" && cliStatus?.tailscaleSelf
      ? cliStatus.tailscaleSelf
      : ipcTailscaleSelf;
  const tailscaleIdentity = useMemo(
    () => identityFromTailscaleSelf(tailscaleSelf),
    [tailscaleSelf],
  );

  return {
    acknowledgeLinuxOnboardingComplete,
    acknowledgePairing,
    acknowledgeWelcome,
    audio,
    backendAuth: cliStatus?.backendAuth ?? null,
    checkError,
    checkHealth,
    checkPrerequisites,
    cliStatusChecked,
    cliVersions: cliStatus?.versions ?? null,
    cloudState,
    cloudStateError,
    flagsLoaded,
    forceOnboarding,
    healthChecking,
    isCheckingPrerequisites,
    loginAttempts,
    loginStatus: cliStatus?.loginStatus ?? null,
    linuxOnboardingCompleted,
    openTailscaleApp,
    openTailscaleDownload,
    pairingAcknowledged,
    prerequisites,
    refreshCliOnboardingStatus,
    refreshCloudState,
    refreshTailscaleIdentity,
    registerLoginAttempt,
    saveVoiceKeys,
    setVoiceKeyInputs,
    status,
    tailscaleIdentity,
    tailscaleServe: cliStatus?.tailscaleServe ?? null,
    voiceKeyError,
    voiceKeyInputs,
    voiceKeysJustSaved,
    voiceKeysSaving,
    welcomeAcknowledged,
  };
}
