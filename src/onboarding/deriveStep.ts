import type { OnboardingPage } from "./types";

/**
 * The onboarding step the app should present. Either one of the pages, or
 * "complete" when every step's goal is satisfied and the console can show.
 */
export type OnboardingStep = OnboardingPage | "complete";

/** Canonical flow order; earlier pages come first. */
export const ONBOARDING_FLOW_ORDER: readonly OnboardingPage[] = [
  "welcome",
  "prerequisites",
  "setup",
  "backendAuth",
  "voiceKeys",
  "login",
  "mobile",
  "pairing",
  "verify",
];

export function onboardingFlowIndex(page: OnboardingPage): number {
  return ONBOARDING_FLOW_ORDER.indexOf(page);
}

export type OnboardingPageState = "current" | "done" | "todo";

/**
 * Observable facts the current onboarding step is derived from. Everything
 * here is either machine state (backend health, prerequisites, login, cloud
 * pairing) or explicit user intent — never "which page we last showed".
 */
export type OnboardingFacts = {
  /**
   * The selected coding backend (Codex/Claude Code) can start sessions
   * without an interactive login. True when the CLI does not report
   * backend_auth (older CLI) or the backend's auth rides on the Openbase
   * login (openbase_cloud), so only a genuinely missing agent sign-in blocks.
   */
  backendAuthReady: boolean;
  /** GET /api/health/ returned OK (status === "ready"). */
  backendReady: boolean;
  /** The Electron installer bridge (window.__OPENBASE_INSTALLER__) loaded. */
  installerPresent: boolean;
  /** Openbase login is authenticated on this machine. */
  loggedIn: boolean;
  /** At least one mobile device is linked to the account. */
  mobileAuthenticated: boolean;
  /** User finished phone pairing. Durable flag. */
  pairingAcknowledged: boolean;
  /** Prerequisites were checked and every required one is satisfied. */
  requiredPrerequisitesOk: boolean;
  /** `openbase-coder setup` completed successfully this session. */
  setupSucceeded: boolean;
  /** Both the desktop and a mobile device advertise Tailscale addresses. */
  tailscalePaired: boolean;
  /** Voice audio is configured for the selected audio provider. */
  voiceConfigured: boolean;
  /** User clicked through the welcome page. Durable flag. */
  welcomeAcknowledged: boolean;
};

/**
 * Derive the current onboarding step from observable facts.
 *
 * Returns the FIRST step in flow order whose goal is not yet met, so no
 * entry path (deep link, resume, wipe) can ever land the user on a page
 * whose preconditions do not hold. Returns "complete" when everything holds.
 *
 * Step goals, in order:
 * - welcome:       welcome acknowledged; skipped entirely on machines that
 *                  already completed pairing once — a later broken fact
 *                  routes straight to its step instead of re-touring
 * - prerequisites: bridge present and required prerequisites verified
 * - setup:         backend ready, or setup succeeded this session
 * - backendAuth:   the selected coding backend is signed in
 * - voiceKeys:     voice audio configured for the selected provider
 * - login:         Openbase login authenticated
 * - mobile:        a phone is linked to the signed-in account
 * - pairing:       pairing acknowledged after the devices are paired
 * - verify:        backend healthy again (only reachable as the derived step
 *                  when setup succeeded but the backend later went unhealthy)
 */
export function deriveOnboardingStep(facts: OnboardingFacts): OnboardingStep {
  if (!facts.welcomeAcknowledged && !facts.pairingAcknowledged) {
    return "welcome";
  }
  if (!facts.installerPresent || !facts.requiredPrerequisitesOk) {
    return "prerequisites";
  }
  if (!facts.backendReady && !facts.setupSucceeded) {
    return "setup";
  }
  if (!facts.backendAuthReady) {
    return "backendAuth";
  }
  if (!facts.voiceConfigured) {
    return "voiceKeys";
  }
  if (!facts.loggedIn) {
    return "login";
  }
  if (!facts.mobileAuthenticated) {
    return "mobile";
  }
  if (!facts.pairingAcknowledged) {
    return "pairing";
  }
  if (!facts.backendReady) {
    return "verify";
  }
  return "complete";
}

/**
 * Whether onboarding is complete enough to leave the shell and show the app.
 *
 * The welcome/overview page is a per-session gate for incomplete onboarding;
 * it must not force already-configured users back into onboarding on every
 * launch.
 */
export function deriveOnboardingComplete(facts: OnboardingFacts): boolean {
  return deriveOnboardingStep({ ...facts, welcomeAcknowledged: true }) === "complete";
}

/**
 * Launch-time fact sources, each true once its first fetch has settled
 * (successfully or not). While a source is unresolved, its facts still hold
 * their pessimistic defaults, which must not be mistaken for a real "not
 * configured" answer.
 */
export type LaunchProbes = {
  /**
   * GET /api/onboarding/status/ settled at least once (it is only fetched
   * after health reports ready). Gates every payload-backed fact whose
   * missing-data default is optimistic — backend auth and voice readiness
   * default to ready/configured, so they must not prove completion, and
   * loggedIn must not rule it out, until the payload answered.
   */
  cliStatusResolved: boolean;
  /** Live cloud pairing state returned or errored (fetched once logged in). */
  cloudStateResolved: boolean;
  /** The ~/.openbase/desktop-onboarding.json flags were read. */
  flagsLoaded: boolean;
  /** GET /api/health/ settled (ready or unavailable). */
  healthResolved: boolean;
  /** The prerequisite scan (including Tailscale identity) reported or errored. */
  prerequisitesResolved: boolean;
};

/**
 * True while launch cannot yet tell a fully configured machine from an
 * unconfigured one: completion is not proven, but every fact that currently
 * blocks it comes from a probe that has not resolved. The shell holds a
 * loading screen while this is true instead of flashing the welcome step at
 * already-onboarded users. The moment a resolved fact rules completion out —
 * or every probe resolves — this returns false and stays false.
 */
export function deriveLaunchSettling(
  facts: OnboardingFacts,
  probes: LaunchProbes,
): boolean {
  // Completion is only proven by resolved facts. Backend auth and voice
  // readiness default to ready/configured while the CLI's answer is
  // pending, so they must not prove completion by themselves — otherwise a
  // stale agent sign-in or missing voice keys briefly show the console
  // before bouncing back into onboarding.
  const proven = deriveOnboardingComplete({
    ...facts,
    backendAuthReady: probes.cliStatusResolved ? facts.backendAuthReady : false,
    voiceConfigured: probes.cliStatusResolved ? facts.voiceConfigured : false,
  });
  if (proven) {
    return false;
  }
  const optimistic: OnboardingFacts = {
    ...facts,
    backendReady: probes.healthResolved ? facts.backendReady : true,
    loggedIn: probes.cliStatusResolved ? facts.loggedIn : true,
    mobileAuthenticated: probes.cloudStateResolved ? facts.mobileAuthenticated : true,
    pairingAcknowledged: probes.flagsLoaded ? facts.pairingAcknowledged : true,
    requiredPrerequisitesOk: probes.prerequisitesResolved
      ? facts.requiredPrerequisitesOk
      : true,
    tailscalePaired: probes.cloudStateResolved ? facts.tailscalePaired : true,
  };
  return deriveOnboardingComplete(optimistic);
}

/**
 * Resolve the page to render from the derived step plus an optional user
 * override. Overrides let the user look back at earlier steps, but can never
 * place them beyond the derived step (requests past it are clamped back).
 */
export function resolveOnboardingPage(
  derived: OnboardingStep,
  override: OnboardingPage | null,
): OnboardingPage {
  const derivedPage: OnboardingPage = derived === "complete" ? "verify" : derived;
  if (override && onboardingFlowIndex(override) <= onboardingFlowIndex(derivedPage)) {
    return override;
  }
  return derivedPage;
}

export function deriveOnboardingPageStates(
  facts: OnboardingFacts,
  currentPage: OnboardingPage,
): Record<OnboardingPage, OnboardingPageState> {
  const welcomeDone = facts.welcomeAcknowledged || facts.pairingAcknowledged;
  const prerequisitesDone = welcomeDone && facts.requiredPrerequisitesOk;
  const setupDone = prerequisitesDone && (facts.backendReady || facts.setupSucceeded);
  const backendAuthDone = setupDone && facts.backendAuthReady;
  const voiceDone = backendAuthDone && facts.voiceConfigured;
  const loginDone = voiceDone && facts.loggedIn;
  const mobileDone = loginDone && facts.mobileAuthenticated;
  const pairingDone = mobileDone && facts.pairingAcknowledged;
  const verifyDone = pairingDone && facts.backendReady;

  const state = (page: OnboardingPage, done: boolean): OnboardingPageState =>
    currentPage === page ? "current" : done ? "done" : "todo";

  return {
    welcome: state("welcome", welcomeDone),
    prerequisites: state("prerequisites", prerequisitesDone),
    setup: state("setup", setupDone),
    backendAuth: state("backendAuth", backendAuthDone),
    voiceKeys: state("voiceKeys", voiceDone),
    login: state("login", loginDone),
    mobile: state("mobile", mobileDone),
    pairing: state("pairing", pairingDone),
    verify: state("verify", verifyDone),
  };
}
