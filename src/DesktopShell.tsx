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
import { productAnalytics } from "./analytics";
import { ProductAnalyticsPreference } from "./ProductAnalyticsPreference";
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
import {
  deriveCloudPairingFacts,
  localBackendReadyForOnboarding,
  privateNetworkPairingReady,
} from "./onboarding/cloudPairing";
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
import type {
  BackendChoice,
  OnboardingPage,
  TailnetExperience,
} from "./onboarding/types";
import { useInstaller } from "./onboarding/useInstaller";
import { useLinuxTailscaleOnboarding } from "./onboarding/useLinuxTailscaleOnboarding";
import { useOnboardingState } from "./onboarding/useOnboardingState";
import {
  applyTailscaleConnectionPrerequisite,
  type TailnetProvider,
} from "./onboarding/tailscaleConnectionPrerequisite";

export default function DesktopShell({ children }: { children: ReactNode }) {
  const backendBaseUrl = useMemo(() => getBackendBaseUrl(), []);
  const developerDashboardOnly =
    (
      window.__OPENBASE_RUNTIME_CONFIG__ as
        | { developerDashboardOnly?: boolean }
        | undefined
    )?.developerDashboardOnly === true;
  const installer = window.__OPENBASE_INSTALLER__;
  // Voluntary "look back" navigation only; the step the flow is actually on
  // is derived from observable facts (see deriveOnboardingStep).
  const [pageOverride, setPageOverride] = useState<OnboardingPage | null>(null);
  const [selectedBackend, setSelectedBackend] = useState<BackendChoice>(DEFAULT_SETUP_BACKEND);
  // This machine's tailnet transport (mirrors the CLI env; account-level
  // choices flow through the CLI's orchestrator).
  const [tailnetProvider, setTailnetProvider] = useState<TailnetProvider>("tailscale");
  const [tailnetOptions, setTailnetOptions] = useState<TailnetExperience[]>([]);
  const [tailnetCatalogError, setTailnetCatalogError] = useState<string | null>(null);
  const refreshTailnetProvider = useCallback(async () => {
    try {
      const result = await installer?.tailnetProvider?.();
      if (!result?.ok || !result.options) {
        setTailnetCatalogError(
          result?.error || "Could not load networking choices from the Openbase CLI.",
        );
        return;
      }
      const supportedOptions = result.options.filter(
        (option) =>
          option.electron_onboarding &&
          (!installer?.platform ||
            option.electron_platforms.includes(installer.platform)),
      );
      if (supportedOptions.length === 0) {
        setTailnetCatalogError(
          "This Openbase CLI did not provide a networking option for this platform.",
        );
        return;
      }
      setTailnetCatalogError(null);
      setTailnetOptions(supportedOptions);
      setTailnetProvider(
        supportedOptions.some((option) => option.provider === result.provider)
          ? (result.provider as TailnetProvider)
          : "tailscale",
      );
    } catch (error) {
      setTailnetCatalogError(
        error instanceof Error
          ? error.message
          : "Could not load networking choices from the Openbase CLI.",
      );
    }
  }, [installer]);
  useEffect(() => {
    void refreshTailnetProvider();
  }, [refreshTailnetProvider]);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  // Latched open once the launch probes settle; see launchSettling below.
  const [launchGateOpen, setLaunchGateOpen] = useState(false);
  const autoMacRegistrationAttemptRef = useRef<string | null>(null);
  const appSessionTrackedRef = useRef(false);
  const onboardingStartedAtRef = useRef<number | null>(null);
  const onboardingStepStartedAtRef = useRef(Date.now());
  const lastOnboardingPageRef = useRef<OnboardingPage | null>(null);
  const completedOnboardingStepsRef = useRef(new Set<OnboardingPage>());
  const onboardingCompletedTrackedRef = useRef(false);
  const onboardingErrorsTrackedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!appSessionTrackedRef.current) {
      appSessionTrackedRef.current = true;
      productAnalytics.trackSessionStartedOnce();
    }
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
        tailnetProvider,
      ),
    [installer?.platform, prerequisites, tailnetProvider, tailscaleIdentity],
  );

  const chooseTailnetProvider = useCallback(
    (provider: TailnetProvider) => {
      // Selection is setup input, not a provider switch. Setup owns first
      // installation; invoking tailnet set-provider before it exists would
      // try to restart and register services that have not been installed.
      setTailnetProvider(provider);
    },
    [],
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
  const backendReadyForOnboarding = localBackendReadyForOnboarding(status);
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
  const privateNetworkHealthy = tailscaleServe?.healthy === true;
  const pairingReady = privateNetworkPairingReady(
    tailscalePaired,
    tailscaleServe?.healthy,
  );
  const effectivePairingDiagnosticMessages = [
    ...pairingDiagnosticMessages,
    ...(tailscalePaired && !privateNetworkHealthy
      ? ["The devices are registered, but the selected private-network routes are not healthy yet."]
      : []),
  ];
  const onboardingFacts = {
    backendAuthReady,
    backendReady: backendReadyForOnboarding,
    installerPresent: Boolean(installer),
    loggedIn,
    mobileAuthenticated,
    pairingAcknowledged,
    requiredPrerequisitesOk,
    setupSucceeded,
    tailscalePaired: pairingReady,
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

  useEffect(() => {
    const now = Date.now();
    if (onboardingComplete && !forceOnboarding) {
      if (
        onboardingStartedAtRef.current !== null &&
        !onboardingCompletedTrackedRef.current
      ) {
        onboardingCompletedTrackedRef.current = true;
        productAnalytics.track("onboarding_completed", {
          duration_ms: now - onboardingStartedAtRef.current,
        });
      }
      return;
    }
    if (!launchGateOpen) return;

    if (onboardingStartedAtRef.current === null) {
      onboardingStartedAtRef.current = now;
      productAnalytics.track("onboarding_started", {
        entry_mode: forceOnboarding ? "forced_replay" : "first_run_or_resume",
      });
    }
    if (lastOnboardingPageRef.current !== page) {
      lastOnboardingPageRef.current = page;
      onboardingStepStartedAtRef.current = now;
      productAnalytics.track("onboarding_step_viewed", {
        step_id: page,
        step_index: onboardingFlowIndex(page) + 1,
        step_count: pages.length,
      });
    }
  }, [forceOnboarding, launchGateOpen, onboardingComplete, page, pages.length]);

  const completeOnboardingStep = useCallback(
    (step: OnboardingPage, completionMethod = "continue") => {
      if (completedOnboardingStepsRef.current.has(step)) return;
      completedOnboardingStepsRef.current.add(step);
      productAnalytics.track("onboarding_step_completed", {
        step_id: step,
        duration_ms: Math.max(0, Date.now() - onboardingStepStartedAtRef.current),
        completion_method: completionMethod,
      });
    },
    [],
  );

  useEffect(() => {
    const errors: Array<[string, boolean]> = [
      ["prerequisite_check_failed", Boolean(checkError)],
      ["setup_command_failed", Boolean(commandError)],
      ["voice_configuration_failed", Boolean(voiceKeyError)],
      ["cloud_state_unavailable", Boolean(cloudStateError)],
      ["tailscale_connection_failed", Boolean(linuxTailscaleError)],
    ];
    for (const [errorCode, active] of errors) {
      const key = `${page}:${errorCode}`;
      if (!active || onboardingErrorsTrackedRef.current.has(key)) continue;
      onboardingErrorsTrackedRef.current.add(key);
      productAnalytics.track("onboarding_step_failed", {
        step_id: page,
        error_code: errorCode,
        is_retryable: true,
      });
    }
  }, [checkError, cloudStateError, commandError, linuxTailscaleError, page, voiceKeyError]);

  if (developerDashboardOnly) {
    return (
      <>
        <DesktopControlNotice />
        {children}
      </>
    );
  }

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
        <ProductAnalyticsPreference />
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
      <ProductAnalyticsPreference />
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
                completeOnboardingStep("welcome");
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
              onContinue={() => {
                completeOnboardingStep("prerequisites");
                clearPageOverride();
              }}
              onDownloadTailscale={() => void openTailscaleDownload()}
              onOpenTailscale={() => void openTailscaleApp()}
              onRefreshTailnetOptions={() => void refreshTailnetProvider()}
              onStartCommand={(commandId) => void startCommand(commandId)}
              onChooseTailnetProvider={(provider) => void chooseTailnetProvider(provider)}
              platform={installer?.platform}
              prerequisites={effectivePrerequisites}
              runningCommand={runningCommand}
              tailnetProvider={tailnetProvider}
              tailnetOptions={tailnetOptions}
              tailnetOptionsError={tailnetCatalogError}
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
              onContinue={() => {
                completeOnboardingStep("setup");
                clearPageOverride();
              }}
              installedBackend={installedBackend}
              onStartCommand={startCommand}
              runningCommand={runningCommand}
              selectedBackend={selectedBackend}
              setSelectedBackend={setSelectedBackend}
              setupSteps={setupSteps}
              setupSucceeded={setupSucceeded}
              tailnetProvider={tailnetProvider}
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
              onContinue={() => {
                completeOnboardingStep("backendAuth");
                clearPageOverride();
              }}
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
              onContinue={() => {
                completeOnboardingStep("voiceKeys");
                clearPageOverride();
              }}
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
              onContinue={() => {
                completeOnboardingStep("login");
                clearPageOverride();
              }}
              onRefreshLoginStatus={() => void refreshCliOnboardingStatus()}
              onStartCommand={startCommand}
              runningCommand={runningCommand}
            />
          )}

          {page === "mobile" && (
            <MobilePage
              cloudStateError={cloudStateError}
              mobileAuthenticated={mobileAuthenticated}
              onContinue={() => {
                completeOnboardingStep("mobile");
                clearPageOverride();
              }}
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
                  completeOnboardingStep("pairing");
                  acknowledgePairing();
                  clearPageOverride();
                }}
                onRefreshTailscale={() => void refreshTailscaleIdentity()}
                pairingDiagnosticMessages={effectivePairingDiagnosticMessages}
                registrationRunning={runningCommand === "onboardingReport"}
                tailscaleIdentity={tailscaleIdentity}
                tailscalePaired={pairingReady}
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
                networkConnecting={runningCommand === "tailnetSetProvider"}
                onConnectNetwork={() =>
                  void startCommand("tailnetSetProvider", { provider: tailnetProvider })
                }
                onContinue={() => {
                  completeOnboardingStep("pairing");
                  acknowledgePairing();
                  clearPageOverride();
                }}
                onRefreshTailscale={() => void refreshTailscaleIdentity()}
                registrationRunning={runningCommand === "onboardingReport"}
                pairingDiagnosticMessages={effectivePairingDiagnosticMessages}
                tailscaleIdentity={tailscaleIdentity}
                tailscalePaired={pairingReady}
                tailnetProvider={tailnetProvider}
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
