import { describe, expect, it } from "vitest";

import {
  audioProviderChoice,
  backendChoiceFromCliBackend,
  identityFromTailscaleSelf,
  parseCliOnboardingStatus,
} from "./cliStatus";

describe("parseCliOnboardingStatus", () => {
  it("maps a full payload into renderer facts", () => {
    const parsed = parseCliOnboardingStatus({
      authenticated: true,
      auth_status: { status: "logged_in", validated: true, detail: "" },
      backend_auth: { backend: "claude_code", ready: true },
      audio: {
        provider: "cartesia",
        voice_ready: false,
        keys: { ASSEMBLY_AI_API_KEY: true, CARTESIA_API_KEY: false },
      },
      tailscale_self: { available: true, dns_name: "mac.tailnet.ts.net" },
      tailscale_serve: { healthy: false, error: "serve down" },
      versions: { cli: "0.1.13" },
    });

    expect(parsed.loginStatus).toEqual({
      authenticated: true,
      detail: "",
      email: undefined,
      status: "logged_in",
      validated: true,
    });
    expect(parsed.backendAuth).toEqual({ backend: "claude_code", ready: true });
    expect(parsed.audio).toEqual({
      provider: "cartesia",
      voice_ready: false,
      keys: { ASSEMBLY_AI_API_KEY: true, CARTESIA_API_KEY: false },
    });
    expect(parsed.tailscaleSelf?.dns_name).toBe("mac.tailnet.ts.net");
    expect(parsed.tailscaleServe?.healthy).toBe(false);
    expect(parsed.versions?.cli).toBe("0.1.13");
  });

  it("leaves blocks null on an older CLI payload", () => {
    const parsed = parseCliOnboardingStatus({ cli_configured: true });

    expect(parsed.audio).toBeNull();
    expect(parsed.backendAuth).toBeNull();
    expect(parsed.loginStatus).toBeNull();
    expect(parsed.tailscaleSelf).toBeNull();
    expect(parsed.tailscaleServe).toBeNull();
  });
});

describe("identityFromTailscaleSelf", () => {
  it("maps a connected identity", () => {
    expect(
      identityFromTailscaleSelf({
        available: true,
        dns_name: "mac.tailnet.ts.net",
        ips: ["100.1.2.3"],
        node_hostname: "mac",
        tailnet: "tailnet.ts.net",
        tailscale_available: true,
      }),
    ).toEqual({
      connected: true,
      dnsName: "mac.tailnet.ts.net",
      error: null,
      hostName: "mac",
      installed: true,
      ip: "100.1.2.3",
      ok: true,
      tailnet: "tailnet.ts.net",
    });
  });

  it("reports not connected when tailscale is missing", () => {
    const identity = identityFromTailscaleSelf({
      available: false,
      error: "tailscale binary was not found",
      tailscale_available: false,
    });
    expect(identity?.connected).toBe(false);
    expect(identity?.installed).toBe(false);
    expect(identityFromTailscaleSelf(null)).toBeNull();
  });
});

describe("backendChoiceFromCliBackend", () => {
  it("maps cli backend ids to desktop choices", () => {
    expect(backendChoiceFromCliBackend("codex")).toBe("codex");
    expect(backendChoiceFromCliBackend("claude_code")).toBe("claude-code");
    expect(backendChoiceFromCliBackend("openbase_cloud")).toBe("openbase-cloud");
    expect(backendChoiceFromCliBackend("mystery")).toBeNull();
    expect(backendChoiceFromCliBackend(undefined)).toBeNull();
  });
});

describe("audioProviderChoice", () => {
  it("defaults to openbase-cloud when the payload is missing or unknown", () => {
    expect(audioProviderChoice(null)).toBe("openbase-cloud");
    expect(
      audioProviderChoice({ keys: {}, provider: "mystery", voice_ready: true }),
    ).toBe("openbase-cloud");
    expect(
      audioProviderChoice({ keys: {}, provider: "cartesia", voice_ready: false }),
    ).toBe("cartesia");
    expect(
      audioProviderChoice({ keys: {}, provider: "local", voice_ready: true }),
    ).toBe("local");
  });
});
