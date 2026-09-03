import { describe, expect, it } from "vitest";

import {
  deriveLaunchSettling,
  deriveOnboardingComplete,
  deriveOnboardingPageStates,
  deriveOnboardingStep,
  resolveOnboardingPage,
  type LaunchProbes,
  type OnboardingFacts,
} from "./deriveStep";

/** A machine where every onboarding goal is satisfied. */
const allDone: OnboardingFacts = {
  backendAuthReady: true,
  backendReady: true,
  installerPresent: true,
  loggedIn: true,
  mobileAuthenticated: true,
  pairingAcknowledged: true,
  requiredPrerequisitesOk: true,
  setupSucceeded: true,
  tailscalePaired: true,
  voiceConfigured: true,
  welcomeAcknowledged: true,
};

/** A machine with nothing done yet. */
const freshMachine: OnboardingFacts = {
  // Unknown until the backend reports; missing data must never block, so a
  // fresh machine starts with the agent sign-in treated as satisfied.
  backendAuthReady: true,
  backendReady: false,
  installerPresent: true,
  loggedIn: false,
  mobileAuthenticated: false,
  pairingAcknowledged: false,
  requiredPrerequisitesOk: false,
  setupSucceeded: false,
  tailscalePaired: false,
  voiceConfigured: false,
  welcomeAcknowledged: false,
};

const facts = (overrides: Partial<OnboardingFacts>, base = allDone): OnboardingFacts => ({
  ...base,
  ...overrides,
});

describe("deriveOnboardingStep", () => {
  it("starts a fresh machine at welcome", () => {
    expect(deriveOnboardingStep(freshMachine)).toBe("welcome");
  });

  it("returns welcome until the user clicks through on a machine that never completed pairing", () => {
    expect(
      deriveOnboardingStep(
        facts({ pairingAcknowledged: false, welcomeAcknowledged: false }),
      ),
    ).toBe("welcome");
  });

  it("skips the welcome tour on machines that already completed pairing once", () => {
    expect(deriveOnboardingStep(facts({ welcomeAcknowledged: false }))).toBe("complete");
    expect(
      deriveOnboardingStep(
        facts({ backendAuthReady: false, welcomeAcknowledged: false }),
      ),
    ).toBe("backendAuth");
    expect(
      deriveOnboardingStep(facts({ backendReady: false, welcomeAcknowledged: false })),
    ).toBe("verify");
  });

  it("returns prerequisites when required prerequisites are missing after welcome", () => {
    expect(
      deriveOnboardingStep(facts({ welcomeAcknowledged: true }, freshMachine)),
    ).toBe("prerequisites");
  });

  it("returns prerequisites when the installer bridge is absent and the backend is down", () => {
    expect(
      deriveOnboardingStep(
        facts({ backendReady: false, installerPresent: false, setupSucceeded: false }),
      ),
    ).toBe("prerequisites");
  });

  it("returns setup when prerequisites pass but the backend is not ready", () => {
    expect(
      deriveOnboardingStep(
        facts(
          { requiredPrerequisitesOk: true, welcomeAcknowledged: true },
          freshMachine,
        ),
      ),
    ).toBe("setup");
  });

  it("does not skip required prerequisites just because the backend is ready", () => {
    expect(
      deriveOnboardingStep(
        facts({ requiredPrerequisitesOk: false, setupSucceeded: false }),
      ),
    ).toBe("prerequisites");
  });

  it("skips setup once the backend is ready and required prerequisites are ok", () => {
    expect(
      deriveOnboardingStep(
        facts({ requiredPrerequisitesOk: true, setupSucceeded: false }),
      ),
    ).toBe("complete");
  });

  it("returns login when logged out with the backend ready", () => {
    expect(deriveOnboardingStep(facts({ loggedIn: false }))).toBe("login");
  });

  it("returns backendAuth after setup when the coding agent is not signed in", () => {
    expect(deriveOnboardingStep(facts({ backendAuthReady: false }))).toBe("backendAuth");
    expect(
      deriveOnboardingStep(
        facts({ backendAuthReady: false, loggedIn: false, voiceConfigured: false }),
      ),
    ).toBe("backendAuth");
  });

  it("does not surface backendAuth before setup", () => {
    expect(
      deriveOnboardingStep(
        facts(
          {
            backendAuthReady: false,
            requiredPrerequisitesOk: true,
            welcomeAcknowledged: true,
          },
          freshMachine,
        ),
      ),
    ).toBe("setup");
  });

  it("returns mobile when no phone is linked", () => {
    expect(
      deriveOnboardingStep(
        facts({ mobileAuthenticated: false, pairingAcknowledged: false, tailscalePaired: false }),
      ),
    ).toBe("mobile");
  });

  it("returns mobile when no phone is linked even if an old pairing flag exists", () => {
    expect(
      deriveOnboardingStep(
        facts({ mobileAuthenticated: false, pairingAcknowledged: true, tailscalePaired: false }),
      ),
    ).toBe("mobile");
  });

  it("returns pairing when a phone is linked but pairing is not acknowledged", () => {
    expect(
      deriveOnboardingStep(facts({ pairingAcknowledged: false, tailscalePaired: false })),
    ).toBe("pairing");
  });

  it("returns voiceKeys before login/mobile/pairing when voice is unconfigured, even with pairing acknowledged", () => {
    expect(
      deriveOnboardingStep(
        facts({ loggedIn: false, mobileAuthenticated: false, voiceConfigured: false }),
      ),
    ).toBe("voiceKeys");
  });

  it("returns verify when setup succeeded but the backend went unhealthy afterwards", () => {
    expect(deriveOnboardingStep(facts({ backendReady: false }))).toBe("verify");
  });

  it("returns complete when everything holds", () => {
    expect(deriveOnboardingStep(allDone)).toBe("complete");
  });

  // Regression, bug 2: deep-linking back with status ready + logged in used
  // to jump straight to verify, stranding the user with pairing never
  // acknowledged. Derivation must place them at mobile, never complete/verify.
  it("is not complete (and not verify) when ready + logged in but pairing unacknowledged", () => {
    const step = deriveOnboardingStep(
      facts({ mobileAuthenticated: false, pairingAcknowledged: false, tailscalePaired: false }),
    );
    expect(step).toBe("mobile");
    expect(step).not.toBe("complete");
    expect(step).not.toBe("verify");
  });

  // Regression, bug 1: acknowledgements live in the ~/.openbase flags file.
  // A pairing acknowledgement only resumes past pairing when cloud still has
  // a linked phone; wiping cloud device state must bring the user back here.
  it("resumes correctly from persisted acknowledgement flags plus cloud phone state", () => {
    expect(
      deriveOnboardingStep(facts({ mobileAuthenticated: true, tailscalePaired: false })),
    ).toBe("complete");
    expect(
      deriveOnboardingStep(facts({ mobileAuthenticated: false, tailscalePaired: false })),
    ).toBe("mobile");
    expect(
      deriveOnboardingStep(facts({ pairingAcknowledged: false, welcomeAcknowledged: false })),
    ).toBe("welcome");
  });
});

describe("deriveOnboardingComplete", () => {
  it("treats a fully configured install as complete even before the session overview click", () => {
    expect(deriveOnboardingComplete(facts({ welcomeAcknowledged: false }))).toBe(true);
  });

  it("does not treat incomplete onboarding as complete just because overview is skipped for completion checks", () => {
    expect(
      deriveOnboardingComplete(
        facts({ loggedIn: false, welcomeAcknowledged: false }),
      ),
    ).toBe(false);
  });

  it("is not complete while the coding agent still needs a sign-in", () => {
    expect(deriveOnboardingComplete(facts({ backendAuthReady: false }))).toBe(false);
  });
});

describe("deriveLaunchSettling", () => {
  const allUnresolved: LaunchProbes = {
    cliStatusResolved: false,
    cloudStateResolved: false,
    flagsLoaded: false,
    healthResolved: false,
    prerequisitesResolved: false,
  };
  const allResolved: LaunchProbes = {
    cliStatusResolved: true,
    cloudStateResolved: true,
    flagsLoaded: true,
    healthResolved: true,
    prerequisitesResolved: true,
  };
  const probes = (overrides: Partial<LaunchProbes>, base = allUnresolved): LaunchProbes => ({
    ...base,
    ...overrides,
  });
  // What DesktopShell derives on first render: every probe-backed fact at
  // its pessimistic default, session-only facts (installer bridge, voice
  // default, backend auth unknown-is-ready) at their launch values.
  const launchFacts = facts({ voiceConfigured: true }, freshMachine);

  it("holds while every completion-blocking fact is merely unresolved", () => {
    expect(deriveLaunchSettling(launchFacts, allUnresolved)).toBe(true);
  });

  it("opens without holding on a fresh machine once the flags resolve", () => {
    expect(deriveLaunchSettling(launchFacts, probes({ flagsLoaded: true }))).toBe(false);
  });

  it("keeps holding for a previously paired machine while other probes resolve", () => {
    expect(
      deriveLaunchSettling(
        facts({ pairingAcknowledged: true }, launchFacts),
        probes({ flagsLoaded: true }),
      ),
    ).toBe(true);
  });

  it("opens once a resolved fact rules completion out", () => {
    expect(
      deriveLaunchSettling(
        facts({ loggedIn: false }, launchFacts),
        probes({ cliStatusResolved: true }),
      ),
    ).toBe(false);
    expect(
      deriveLaunchSettling(
        facts({ backendReady: false }, launchFacts),
        probes({ healthResolved: true }),
      ),
    ).toBe(false);
    expect(
      deriveLaunchSettling(
        facts({ requiredPrerequisitesOk: false }, launchFacts),
        probes({ prerequisitesResolved: true }),
      ),
    ).toBe(false);
  });

  it("opens straight to complete on a fully configured machine", () => {
    expect(
      deriveLaunchSettling(facts({ welcomeAcknowledged: false }), allResolved),
    ).toBe(false);
  });

  it("keeps holding while the backend is ready but the CLI status answer is pending", () => {
    expect(
      deriveLaunchSettling(
        facts({ welcomeAcknowledged: false }),
        probes({ cliStatusResolved: false }, allResolved),
      ),
    ).toBe(true);
  });

  it("opens to the agent sign-in step once a resolved backend auth rules completion out", () => {
    expect(
      deriveLaunchSettling(
        facts({ backendAuthReady: false, welcomeAcknowledged: false }),
        allResolved,
      ),
    ).toBe(false);
  });

  it("opens to the voice step once resolved voice facts rule completion out", () => {
    expect(
      deriveLaunchSettling(
        facts({ voiceConfigured: false, welcomeAcknowledged: false }),
        allResolved,
      ),
    ).toBe(false);
    expect(
      deriveOnboardingStep(facts({ voiceConfigured: false, welcomeAcknowledged: false })),
    ).toBe("voiceKeys");
  });

  it("keeps holding when only the cloud pairing state is still in flight", () => {
    expect(
      deriveLaunchSettling(
        facts({
          mobileAuthenticated: false,
          tailscalePaired: false,
          welcomeAcknowledged: false,
        }),
        probes({ cloudStateResolved: false }, allResolved),
      ),
    ).toBe(true);
  });

  it("never holds once every probe has resolved", () => {
    expect(deriveLaunchSettling(launchFacts, allResolved)).toBe(false);
  });

  it("never holds when the installer bridge is absent", () => {
    expect(
      deriveLaunchSettling(
        facts({ installerPresent: false }, launchFacts),
        allUnresolved,
      ),
    ).toBe(false);
  });
});

describe("resolveOnboardingPage", () => {
  it("shows the derived step when there is no override", () => {
    expect(resolveOnboardingPage("login", null)).toBe("login");
  });

  it("maps complete to the verify page (forced-onboarding dev mode)", () => {
    expect(resolveOnboardingPage("complete", null)).toBe("verify");
  });

  it("allows looking back at earlier steps", () => {
    expect(resolveOnboardingPage("pairing", "welcome")).toBe("welcome");
    expect(resolveOnboardingPage("pairing", "mobile")).toBe("mobile");
  });

  it("clamps overrides that point past the derived step", () => {
    expect(resolveOnboardingPage("login", "verify")).toBe("login");
    expect(resolveOnboardingPage("mobile", "pairing")).toBe("mobile");
  });
});

describe("deriveOnboardingPageStates", () => {
  it("keeps voice locked when earlier gates are incomplete, even if voice is configured", () => {
    const states = deriveOnboardingPageStates(
      facts({ welcomeAcknowledged: false, voiceConfigured: true }, freshMachine),
      "welcome",
    );

    expect(states.welcome).toBe("current");
    expect(states.prerequisites).toBe("todo");
    expect(states.setup).toBe("todo");
    expect(states.voiceKeys).toBe("todo");
  });

  it("marks prerequisites, setup, and voice done only after earlier gates are complete", () => {
    const states = deriveOnboardingPageStates(
      facts(
        {
          backendReady: true,
          requiredPrerequisitesOk: true,
          setupSucceeded: false,
          voiceConfigured: true,
          welcomeAcknowledged: true,
        },
        freshMachine,
      ),
      "login",
    );

    expect(states.welcome).toBe("done");
    expect(states.prerequisites).toBe("done");
    expect(states.setup).toBe("done");
    expect(states.backendAuth).toBe("done");
    expect(states.voiceKeys).toBe("done");
    expect(states.login).toBe("current");
  });

  it("keeps voice locked behind an unfinished agent sign-in", () => {
    const states = deriveOnboardingPageStates(
      facts({ backendAuthReady: false, voiceConfigured: true }),
      "backendAuth",
    );

    expect(states.setup).toBe("done");
    expect(states.backendAuth).toBe("current");
    expect(states.voiceKeys).toBe("todo");
  });

  it("uses current for the active page instead of a completed checkmark", () => {
    const states = deriveOnboardingPageStates(allDone, "verify");

    expect(states.pairing).toBe("done");
    expect(states.verify).toBe("current");
  });
});
