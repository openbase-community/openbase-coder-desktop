import { CheckCircle2, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AppUpdateNotice } from "./AppUpdateNotice";
import openbaseWordmarkUrl from "../assets/openbase-logo-and-text.svg";
import { DesktopControlNotice } from "./DesktopControlNotice";
import { StatusIcon } from "./onboarding/components/StatusIcon";
import {
  audioProviderOptions,
  CLOUD_STATE_POLL_INTERVAL_MS,
  DEFAULT_SETUP_BACKEND,
  getBackendBaseUrl,
  LAUNCH_SETTLE_TIMEOUT_MS,
  REQUIRED_PREREQUISITE_IDS,
} from "./onboarding/config";
import {
  audioProviderChoice,
  backendChoiceFromCliBackend,
} from "./onboarding/cliStatus";
import { deriveCloudPairingFacts } from "./onboarding/cloudPairing";
import {
  deriveLaunchSettling,
  deriveOnboardingComplete,
  deriveOnboardingPageStates,
  deriveOnboardingStep,
  onboardingFlowIndex,
  resolveOnboardingPage,
} from "./onboarding/deriveStep";
import {
  calmSpring,
  pageVariants,
  PulsingDot,
} from "./onboarding/motion";
import {
  usesDurableLinuxOnboardingCompletion,
  usesManagedLinuxTailscale,
  waitsForLinuxOnboardingFlags,
} from "./onboarding/pairingPlatform";
import { BackendAuthPage } from "./onboarding/pages/BackendAuthPage";
import { LoginPage } from "./onboarding/pages/LoginPage";
import { LinuxPairingPage } from "./onboarding/pages/LinuxPairingPage";
import { MobilePage } from "./onboarding/pages/MobilePage";
import { PairingPage } from "./onboarding/pages/PairingPage";
import { PrerequisitesPage } from "./onboarding/pages/PrerequisitesPage";
import { SetupPage } from "./onboarding/pages/SetupPage";
import { VerifyPage } from "./onboarding/pages/VerifyPage";
import { VoiceKeysPage } from "./onboarding/pages/VoiceKeysPage";
import { WelcomePage } from "./onboarding/pages/WelcomePage";
import type { BackendChoice, OnboardingPage } from "./onboarding/types";
import { useInstaller } from "./onboarding/useInstaller";
import { useLinuxTailscaleOnboarding } from "./onboarding/useLinuxTailscaleOnboarding";
import { useOnboardingState } from "./onboarding/useOnboardingState";
import { applyTailscaleConnectionPrerequisite } from "./onboarding/tailscaleConnectionPrerequisite";

export default function DesktopShell({ children }: { children: ReactNode }) {
  const backendBaseUrl = useMemo(() => getBackendBaseUrl(), []);
  const installer = window.__OPENBASE_INSTALLER__;
  // Voluntary "look back" navigation only; the step the flow is actually on
  // is derived from observable facts (see deriveOnboardingStep).
  const [pageOverride, setPageOverride] = useState<OnboardingPage | null>(null);
  const [selectedBackend, setSelectedBackend] = useState<BackendChoice>(DEFAULT_SETUP_BACKEND);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  // Latched open once the launch probes settle; see launchSettling below.
  const [launchGateOpen, setLaunchGateOpen] = useState(false);
  const autoMacRegistrationAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    // The desktop app's own version, reported by the Electron main process
    // over the app-updates bridge.
    void window.__OPENBASE_APP_UPDATES__?.status()
      .then((result) => {
        if (result.ok && result.appVersion) {
          setAppVersion(result.appVersion);
        }
      })
      .catch((error) => {
        console.error("[app-updates] version lookup failed", error);
      });
  }, []);

  const {
    acknowledgeLinuxOnboardingComplete,
    acknowledgePairing,
    acknowledgeWelcome,
    audio,
    backendAuth,
    checkError,
    checkHealth,
    checkPrerequisites,
    cliStatusChecked,
    cliVersions,
    cloudState,
    cloudStateError,
    flagsLoaded,
    forceOnboarding,
    healthChecking,
    isCheckingPrerequisites,
    loginAttempts,
    loginStatus,
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
    tailscaleServe,
    voiceKeyError,
    voiceKeyInputs,
    voiceKeysJustSaved,
    voiceKeysSaving,
    welcomeAcknowledged,
  } = useOnboardingState(installer, backendBaseUrl);
  const isLinux = usesManagedLinuxTailscale(installer?.platform);
  const {
    connect: connectLinuxTailscale,
    connecting: linuxTailscaleConnecting,
    error: linuxTailscaleError,
  } = useLinuxTailscaleOnboarding(installer, refreshTailscaleIdentity);

  const {
    cancelCommand,
    commandError,
    commandLines,
    lastExit,
    runningCommand,
    setupCompleted,
    setupSteps,
    startCommand,
  } = useInstaller(installer, {
    checkHealth,
    checkPrerequisites,
    onLoginExit: registerLoginAttempt,
    refreshCliOnboardingStatus,
    refreshCloudState,
  });

  const refreshAfterExternalAuthSignal = useCallback(() => {
    // checkHealth re-fetches the CLI status payload (login, agent auth,
    // voice, Tailscale) when the backend answers; cloud pairing state is the
    // only separately fetched fact.
    void checkHealth();
    void refreshCloudState();

    window.setTimeout(() => {
      void refreshCliOnboardingStatus();
      void refreshCloudState();
    }, 1000);
  }, [checkHealth, refreshCliOnboardingStatus, refreshCloudState]);

  const effectivePrerequisites = useMemo(
    () =>
      applyTailscaleConnectionPrerequisite(
        prerequisites,
        installer?.platform,
        tailscaleIdentity,
      ),
    [installer?.platform, prerequisites, tailscaleIdentity],
  );
  const missingPrerequisites = effectivePrerequisites.filter((item) => !item.ok);
  const missingRequiredPrerequisites = missingPrerequisites.filter((item) =>
    REQUIRED_PREREQUISITE_IDS.includes(item.id),
  );
  // Prerequisites count as verified only after an actual check reported
  // every required item ok (an unchecked, empty list proves nothing).
  const requiredPrerequisitesOk =
    effectivePrerequisites.length > 0 && missingRequiredPrerequisites.length === 0;
  const canRunSetup = Boolean(installer) && !runningCommand && requiredPrerequisitesOk;
  const canRunUtilities = Boolean(installer) && !runningCommand;
  const setupHadBlockingWarning = setupSteps.tailscale_serve?.status === "warn";
  // Tailscale Serve health comes from the CLI status payload, so a serve
  // that broke after setup blocks completion on relaunch too — not only in
  // the session that ran setup.
  const backendReadyForOnboarding =
    status === "ready" &&
    !setupHadBlockingWarning &&
    tailscaleServe?.healthy !== false;
  const setupSucceeded = setupCompleted;
  // The install's audio provider and voice readiness are CLI facts; older
  // CLIs that do not report them must never block on voice.
  const selectedAudioProvider = audioProviderChoice(audio);
  const voiceConfigured = audio ? audio.voice_ready : true;
  const selectedAudioProviderOption =
    audioProviderOptions.find((option) => option.id === selectedAudioProvider) ??
    audioProviderOptions[0];
  const loggedIn = Boolean(loginStatus?.authenticated);
  const installedBackend = backendChoiceFromCliBackend(backendAuth?.backend);
  // Older CLIs do not report backend_auth (null): never block on missing
  // data. Openbase Cloud auth rides on the Openbase sign-in step instead.
  const backendAuthReady =
    !backendAuth || backendAuth.backend === "openbase_cloud" || backendAuth.ready;
  const {
    desktopCloudRegistered,
    desktopOnTailscale,
    diagnosticMessages: pairingDiagnosticMessages,
    mobileAuthenticated,
    mobileOnTailscale,
    tailscalePaired,
  } = deriveCloudPairingFacts(cloudState);
  const onboardingFacts = {
    backendAuthReady,
    backendReady: backendReadyForOnboarding,
    installerPresent: Boolean(installer),
    loggedIn,
    mobileAuthenticated,
    pairingAcknowledged,
    requiredPrerequisitesOk,
    setupSucceeded,
    tailscalePaired,
    voiceConfigured,
    welcomeAcknowledged,
  };

  // The step the flow is on is a pure function of observable facts, so no
  // entry path (deep link, resume, reinstall) can land beyond reality.
  const derivedStep = deriveOnboardingStep(onboardingFacts);
  const currentOnboardingComplete =
    flagsLoaded && deriveOnboardingComplete(onboardingFacts);
  const onboardingComplete =
    currentOnboardingComplete ||
    usesDurableLinuxOnboardingCompletion(
      installer?.platform,
      flagsLoaded && linuxOnboardingCompleted,
    );
  // Launch gate: while completion is unproven only because probes are still
  // in flight, hold a loading screen instead of flashing the welcome step at
  // an already-configured machine. One-way: once the probes settle (or the
  // safety timeout fires) the gate stays open, so later refreshes that
  // briefly reset a probe (e.g. window-focus health rechecks) never bring
  // the loading screen back over the onboarding shell.
  const tailscaleGatesPrerequisites =
    installer?.platform === "darwin" || installer?.platform === "linux";
  const launchSettling =
    !launchGateOpen &&
    deriveLaunchSettling(onboardingFacts, {
      cliStatusResolved: cliStatusChecked,
      cloudStateResolved: cloudState !== null || cloudStateError !== null,
      flagsLoaded,
      healthResolved: status !== "checking",
      prerequisitesResolved:
        checkError !== null ||
        (prerequisites.length > 0 &&
          (!tailscaleGatesPrerequisites || tailscaleIdentity !== null)),
    });

  useEffect(() => {
    if (!launchSettling) {
      setLaunchGateOpen(true);
    }
  }, [launchSettling]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setLaunchGateOpen(true),
      LAUNCH_SETTLE_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, []);

  const derivedPage = resolveOnboardingPage(derivedStep, null);
  const page = resolveOnboardingPage(derivedStep, pageOverride);
  const pageStates = deriveOnboardingPageStates(onboardingFacts, page);
  const tailscaleConnected = tailscaleIdentity?.connected === true;
  const macRegistrationComplete = desktopCloudRegistered && desktopOnTailscale;
  const macRegistrationIdentity =
    tailscaleIdentity?.dnsName ||
    tailscaleIdentity?.ip ||
    tailscaleIdentity?.hostName ||
    "connected";

  useEffect(() => {
    if (
      isLinux &&
      currentOnboardingComplete &&
      !linuxOnboardingCompleted
    ) {
      acknowledgeLinuxOnboardingComplete();
    }
  }, [
    acknowledgeLinuxOnboardingComplete,
    currentOnboardingComplete,
    isLinux,
    linuxOnboardingCompleted,
  ]);

  // Voluntary navigation: earlier steps may be revisited; navigating at or
  // past the derived step just clears the override and follows derivation.
  const navigateTo = useCallback(
    (target: OnboardingPage) => {
      setPageOverride(
        onboardingFlowIndex(target) < onboardingFlowIndex(derivedPage) ? target : null,
      );
    },
    [derivedPage],
  );
  const clearPageOverride = useCallback(() => setPageOverride(null), []);

  const backendStatusLabel =
    status === "ready" ? "Backend ready" : status === "checking" ? "Checking backend" : "Needs setup";

  useEffect(() => {
    if (!loggedIn) {
      return undefined;
    }
    void refreshCloudState();
    if (page !== "mobile" && page !== "pairing") {
      return undefined;
    }
    const interval = window.setInterval(() => {
      void refreshCloudState();
    }, CLOUD_STATE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loggedIn, page, refreshCloudState]);

  useEffect(() => {
    // The agent sign-in finishes outside the app (browser OAuth or a
    // terminal `codex login`), so poll the CLI's onboarding status while
    // the user is on the step.
    if (page !== "backendAuth") {
      return undefined;
    }
    void refreshCliOnboardingStatus();
    const interval = window.setInterval(() => {
      void refreshCliOnboardingStatus();
    }, CLOUD_STATE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [page, refreshCliOnboardingStatus]);

  useEffect(() => {
    if (page !== "pairing" && page !== "prerequisites") {
      return undefined;
    }
    void refreshTailscaleIdentity();
    const interval = window.setInterval(() => {
      void refreshTailscaleIdentity();
    }, CLOUD_STATE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [page, refreshTailscaleIdentity]);

  useEffect(() => {
    if (page !== "pairing" || !loggedIn || !tailscaleConnected) {
      autoMacRegistrationAttemptRef.current = null;
      return;
    }
    if (macRegistrationComplete || !canRunUtilities) {
      return;
    }
    const attemptKey = macRegistrationIdentity;
    if (autoMacRegistrationAttemptRef.current === attemptKey) {
      return;
    }
    autoMacRegistrationAttemptRef.current = attemptKey;
    void startCommand("onboardingReport");
  }, [
    canRunUtilities,
    loggedIn,
    macRegistrationComplete,
    macRegistrationIdentity,
    page,
    startCommand,
    tailscaleConnected,
  ]);

  useEffect(() => {
    const deepLinks = window.__OPENBASE_DEEP_LINKS__;
    if (!deepLinks) {
      return undefined;
    }

    return deepLinks.onOpen((payload) => {
      if (payload.intent !== "login-complete" && payload.intent !== "post-subscribe") {
        return;
      }
      // Deep links are requests, not jumps: refresh the facts the link may
      // have changed (browser OAuth or subscription checkout finished) and
      // clear any look-back override so derivation places the user. They can
      // never land beyond the first step whose preconditions are unmet.
      refreshAfterExternalAuthSignal();
      setPageOverride(null);
    });
  }, [refreshAfterExternalAuthSignal]);

  useEffect(() => {
    window.addEventListener("focus", refreshAfterExternalAuthSignal);
    return () => window.removeEventListener("focus", refreshAfterExternalAuthSignal);
  }, [refreshAfterExternalAuthSignal]);

  const pages: { id: OnboardingPage; label: string }[] = [
    { id: "welcome", label: "Overview" },
    { id: "prerequisites", label: "Prerequisites" },
    { id: "setup", label: "Setup" },
    { id: "backendAuth", label: "Agent sign-in" },
    { id: "voiceKeys", label: "Voice" },
    { id: "login", label: "Sign in" },
    { id: "mobile", label: "Phone" },
    { id: "pairing", label: "Pairing" },
    { id: "verify", label: "Verify" },
  ];

  if (
    (waitsForLinuxOnboardingFlags(installer?.platform, flagsLoaded) ||
      launchSettling) &&
    !forceOnboarding
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-500 antialiased">
        <div className="inline-flex items-center gap-3 text-sm font-medium">
          <PulsingDot />
          Opening Openbase…
        </div>
      </div>
    );
  }

  if (onboardingComplete && !forceOnboarding) {
    return (
      <>
        <AppUpdateNotice />
        <DesktopControlNotice />
        {children}
      </>
    );
  }

  return (
    <div
      className="min-h-screen bg-transparent px-6 pb-10 pt-14 text-zinc-900 antialiased"
      data-openbase-onboarding="true"
    >
      <AppUpdateNotice />
      <DesktopControlNotice />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <img
              alt="Openbase"
              className="h-[24px] w-auto select-none"
              draggable={false}
              src={openbaseWordmarkUrl}
            />
            <span className="h-5 w-px bg-primary/15" aria-hidden />
            <p className="text-sm font-medium text-zinc-500">Setting up your Mac</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex h-9 items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-500">
              {status === "checking" || healthChecking ? (
                <PulsingDot />
              ) : (
                <StatusIcon ok={status === "ready"} />
              )}
              {backendStatusLabel}
            </div>
            <motion.button
              className="inline-flex h-9 items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-500 disabled:opacity-40"
              disabled={status === "checking" || healthChecking}
              onClick={() => void checkHealth()}
              transition={calmSpring}
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
            >
              <RefreshCw aria-hidden className="h-3.5 w-3.5" />
              Recheck
            </motion.button>
          </div>
        </header>

        <nav className="flex flex-wrap items-center gap-1">
          {pages.map((item, index) => {
            const state = pageStates[item.id];
            const isCurrent = state === "current";
            const isDone = state === "done";
            const isLocked = state === "todo";

            return (
              <div className="flex items-center" key={item.id}>
                {index > 0 && <div className="mx-1 h-px w-4 bg-zinc-200" />}
                <motion.button
                  aria-disabled={isLocked}
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    isCurrent
                      ? "bg-zinc-900 text-white shadow-md shadow-zinc-900/10"
                      : isDone
                        ? "text-emerald-600 hover:bg-emerald-50"
                        : "cursor-not-allowed text-zinc-300"
                  }`}
                  onClick={() => {
                    if (!isLocked) {
                      navigateTo(item.id);
                    }
                  }}
                  disabled={isLocked}
                  transition={calmSpring}
                  type="button"
                  whileTap={isLocked ? undefined : { scale: 0.97 }}
                >
                  {isDone ? (
                    <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
                  ) : (
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold ${
                        isCurrent ? "bg-white/20" : "bg-zinc-200/70 text-zinc-400"
                      }`}
                    >
                      {index + 1}
                    </span>
                  )}
                  {item.label}
                </motion.button>
              </div>
            );
          })}
        </nav>

        <main>
          <AnimatePresence mode="wait">
          <motion.div animate="animate" exit="exit" initial="initial" key={page} variants={pageVariants}>
          {page === "welcome" && (
            <WelcomePage
              onContinue={() => {
                acknowledgeWelcome();
                clearPageOverride();
              }}
            />
          )}

          {page === "prerequisites" && (
            <PrerequisitesPage
              canRunSetup={canRunSetup}
              checkError={checkError}
              commandError={commandError}
              hasInstaller={Boolean(installer)}
              isCheckingPrerequisites={isCheckingPrerequisites}
              missingPrerequisites={missingPrerequisites}
              missingRequiredPrerequisites={missingRequiredPrerequisites}
              onCheckPrerequisites={checkPrerequisites}
              onConnectTailscale={() => void connectLinuxTailscale()}
              onContinue={clearPageOverride}
              onDownloadTailscale={() => void openTailscaleDownload()}
              onOpenTailscale={() => void openTailscaleApp()}
              onStartCommand={(commandId) => void startCommand(commandId)}
              prerequisites={effectivePrerequisites}
              runningCommand={runningCommand}
              tailscaleConnecting={linuxTailscaleConnecting}
              tailscaleError={linuxTailscaleError}
            />
          )}

          {page === "setup" && (
            <SetupPage
              canRunSetup={canRunSetup}
              commandError={commandError}
              commandLines={commandLines}
              canContinue={setupSucceeded}
              lastExit={lastExit}
              onCancelCommand={() => void cancelCommand()}
              onContinue={clearPageOverride}
              installedBackend={installedBackend}
              onStartCommand={startCommand}
              runningCommand={runningCommand}
              selectedBackend={selectedBackend}
              setSelectedBackend={setSelectedBackend}
              setupSteps={setupSteps}
              setupSucceeded={setupSucceeded}
            />
          )}

          {page === "backendAuth" && (
            <BackendAuthPage
              backendAuth={backendAuth}
              backendAuthReady={backendAuthReady}
              canRunUtilities={canRunUtilities}
              commandError={commandError}
              commandLines={commandLines}
              onCancelCommand={() => void cancelCommand()}
              onContinue={clearPageOverride}
              onRecheck={() => void refreshCliOnboardingStatus()}
              onStartCommand={startCommand}
              runningCommand={runningCommand}
            />
          )}

          {page === "voiceKeys" && (
            <VoiceKeysPage
              audio={audio}
              canRunUtilities={canRunUtilities}
              commandError={commandError}
              onContinue={clearPageOverride}
              onSaveVoiceKeys={saveVoiceKeys}
              onStartCommand={startCommand}
              selectedAudioProvider={selectedAudioProvider}
              selectedAudioProviderOption={selectedAudioProviderOption}
              setVoiceKeyInputs={setVoiceKeyInputs}
              voiceConfigured={voiceConfigured}
              voiceKeyError={voiceKeyError}
              voiceKeyInputs={voiceKeyInputs}
              voiceKeysJustSaved={voiceKeysJustSaved}
              voiceKeysSaving={voiceKeysSaving}
            />
          )}

          {page === "login" && (
            <LoginPage
              canRunUtilities={canRunUtilities}
              commandError={commandError}
              commandLines={commandLines}
              loggedIn={loggedIn}
              loginAttempts={loginAttempts}
              loginStatus={loginStatus}
              onCancelCommand={() => void cancelCommand()}
              onContinue={clearPageOverride}
              onRefreshLoginStatus={() => void refreshCliOnboardingStatus()}
              onStartCommand={startCommand}
              runningCommand={runningCommand}
            />
          )}

          {page === "mobile" && (
            <MobilePage
              cloudStateError={cloudStateError}
              mobileAuthenticated={mobileAuthenticated}
              onContinue={clearPageOverride}
            />
          )}

          {page === "pairing" &&
            (isLinux ? (
              <LinuxPairingPage
                cloudStateError={cloudStateError}
                commandError={commandError}
                commandLines={commandLines}
                desktopCloudRegistered={desktopCloudRegistered}
                desktopOnTailscale={desktopOnTailscale}
                lastExit={lastExit?.commandId === "onboardingReport" ? lastExit : null}
                linuxTailscaleConnecting={linuxTailscaleConnecting}
                linuxTailscaleError={linuxTailscaleError}
                localAuthenticated={loggedIn}
                mobileAuthenticated={mobileAuthenticated}
                mobileOnTailscale={mobileOnTailscale}
                onConnectTailscale={() => void connectLinuxTailscale()}
                onContinue={() => {
                  acknowledgePairing();
                  clearPageOverride();
                }}
                onRefreshTailscale={() => void refreshTailscaleIdentity()}
                pairingDiagnosticMessages={pairingDiagnosticMessages}
                registrationRunning={runningCommand === "onboardingReport"}
                tailscaleIdentity={tailscaleIdentity}
                tailscalePaired={tailscalePaired}
              />
            ) : (
              <PairingPage
                cloudStateError={cloudStateError}
                commandError={commandError}
                commandLines={commandLines}
                desktopCloudRegistered={desktopCloudRegistered}
                desktopOnTailscale={desktopOnTailscale}
                lastExit={lastExit?.commandId === "onboardingReport" ? lastExit : null}
                macAuthenticated={loggedIn}
                mobileAuthenticated={mobileAuthenticated}
                mobileOnTailscale={mobileOnTailscale}
                onContinue={() => {
                  acknowledgePairing();
                  clearPageOverride();
                }}
                onOpenTailscale={() => void openTailscaleApp()}
                onRefreshTailscale={() => void refreshTailscaleIdentity()}
                registrationRunning={runningCommand === "onboardingReport"}
                pairingDiagnosticMessages={pairingDiagnosticMessages}
                tailscaleIdentity={tailscaleIdentity}
                tailscalePaired={tailscalePaired}
              />
            ))}

          {page === "verify" && (
            <VerifyPage
              appVersion={appVersion}
              backendBaseUrl={backendBaseUrl}
              backendStatusLabel={backendStatusLabel}
              canRunUtilities={canRunUtilities}
              cliVersions={cliVersions}
              commandError={commandError}
              commandLines={commandLines}
              loggedIn={loggedIn}
              loginStatus={loginStatus}
              onCheckHealth={() => void checkHealth()}
              onReviewPrerequisites={() => navigateTo("prerequisites")}
              onStartCommand={startCommand}
              selectedAudioProvider={selectedAudioProvider}
              selectedAudioProviderOption={selectedAudioProviderOption}
              status={status}
              voiceConfigured={voiceConfigured}
            />
          )}
          </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
