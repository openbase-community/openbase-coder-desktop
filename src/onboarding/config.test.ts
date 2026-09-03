import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUDIO_PROVIDER,
  DEFAULT_SETUP_BACKEND,
  existingMachineBackendOptions,
  NORMAL_ONBOARDING_AUDIO_PROVIDER,
  NORMAL_ONBOARDING_BACKEND,
  setupCommandText,
} from "./config";

describe("onboarding setup defaults", () => {
  it("uses Openbase Cloud as the only normal setup path", () => {
    expect(DEFAULT_SETUP_BACKEND).toBe("openbase-cloud");
    expect(DEFAULT_AUDIO_PROVIDER).toBe("openbase-cloud");
    expect(NORMAL_ONBOARDING_BACKEND).toBe("openbase-cloud");
    expect(NORMAL_ONBOARDING_AUDIO_PROVIDER).toBe("openbase-cloud");
    expect(setupCommandText()).toBe(
      "openbase-coder setup --backend openbase-cloud --audio-provider openbase-cloud",
    );
  });

  it("keeps developer override command generation available", () => {
    expect(setupCommandText("codex", "openbase-cloud", false, false)).toBe(
      "openbase-coder setup --backend codex --audio-provider openbase-cloud --no-fast-mode",
    );
  });

  it("offers only Codex then Claude Code behind the existing-machine gate", () => {
    expect(existingMachineBackendOptions.map((option) => option.id)).toEqual([
      "codex",
      "claude-code",
    ]);
  });
});
