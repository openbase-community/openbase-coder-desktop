import type {
  AudioProviderChoice,
  BackendAuthStatus,
  BackendChoice,
  CliAudioStatus,
  CliTailscaleSelf,
  CliTailscaleServe,
  CliVersions,
  LoginStatus,
  TailscaleIdentityStatus,
} from "./types";

/**
 * The onboarding facts the desktop consumes from the CLI's
 * GET /api/onboarding/status/ payload. The CLI is the single implementation
 * of every check here; this module only maps its payload into renderer
 * shapes, tolerating older CLIs by leaving missing blocks null.
 */
export type CliOnboardingStatus = {
  audio: CliAudioStatus | null;
  backendAuth: BackendAuthStatus | null;
  loginStatus: LoginStatus | null;
  tailscaleSelf: CliTailscaleSelf | null;
  tailscaleServe: CliTailscaleServe | null;
  versions: CliVersions | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseCliOnboardingStatus(payload: unknown): CliOnboardingStatus {
  const root = asObject(payload) ?? {};

  const backendAuthRaw = asObject(root.backend_auth);
  const backendAuth =
    backendAuthRaw &&
    typeof backendAuthRaw.backend === "string" &&
    typeof backendAuthRaw.ready === "boolean"
      ? ({ backend: backendAuthRaw.backend, ready: backendAuthRaw.ready } as BackendAuthStatus)
      : null;

  const audioRaw = asObject(root.audio);
  const audioKeys = asObject(audioRaw?.keys) ?? {};
  const audio: CliAudioStatus | null =
    audioRaw && typeof audioRaw.provider === "string"
      ? {
          keys: {
            ASSEMBLY_AI_API_KEY: audioKeys.ASSEMBLY_AI_API_KEY === true,
            CARTESIA_API_KEY: audioKeys.CARTESIA_API_KEY === true,
          },
          provider: audioRaw.provider,
          voice_ready: audioRaw.voice_ready === true,
        }
      : null;

  const authRaw = asObject(root.auth_status);
  const authStatusValue =
    authRaw &&
    typeof authRaw.status === "string" &&
    ["logged_in", "logged_out", "login_expired"].includes(authRaw.status)
      ? (authRaw.status as LoginStatus["status"])
      : undefined;
  const loginStatus: LoginStatus | null =
    typeof root.authenticated === "boolean"
      ? {
          authenticated: root.authenticated,
          detail: typeof authRaw?.detail === "string" ? authRaw.detail : undefined,
          email: typeof authRaw?.email === "string" ? authRaw.email : undefined,
          status: authStatusValue,
          validated: authRaw?.validated === true,
        }
      : null;

  return {
    audio,
    backendAuth,
    loginStatus,
    tailscaleSelf: (asObject(root.tailscale_self) as CliTailscaleSelf | null) ?? null,
    tailscaleServe: (asObject(root.tailscale_serve) as CliTailscaleServe | null) ?? null,
    versions: (asObject(root.versions) as CliVersions | null) ?? null,
  };
}

/** Map the CLI's `tailscale_self` block to the renderer's identity shape. */
export function identityFromTailscaleSelf(
  self: CliTailscaleSelf | null,
): TailscaleIdentityStatus | null {
  if (!self) {
    return null;
  }
  const connected = self.available === true;
  return {
    connected,
    dnsName: self.dns_name ?? null,
    error: self.error ?? null,
    hostName: self.node_hostname ?? null,
    installed: self.tailscale_available !== false,
    ip: Array.isArray(self.ips) && self.ips.length > 0 ? self.ips[0] : null,
    ok: connected,
    tailnet: self.tailnet ?? null,
  };
}

/** CLI backend ids (codex, claude_code, openbase_cloud) → desktop choices. */
export function backendChoiceFromCliBackend(
  backend: string | null | undefined,
): BackendChoice | null {
  switch (backend) {
    case "codex":
      return "codex";
    case "claude_code":
      return "claude-code";
    case "openbase_cloud":
      return "openbase-cloud";
    default:
      return null;
  }
}

/** The install's audio provider as a desktop choice (default openbase-cloud). */
export function audioProviderChoice(audio: CliAudioStatus | null): AudioProviderChoice {
  if (audio?.provider === "cartesia") {
    return "cartesia";
  }
  if (audio?.provider === "local") {
    return "local";
  }
  return "openbase-cloud";
}
