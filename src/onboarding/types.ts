import type installerCommands from "../../electron/installer-commands.json";

export type RuntimeConfig = {
  backendBaseUrl?: string;
  routerBasename?: string;
  shell?: "web" | "electron";
};

export type BackendStatus = "checking" | "ready" | "unavailable";
export type BackendChoice = "codex" | "claude-code" | "openbase-cloud";
export type AudioProviderChoice = "openbase-cloud" | "cartesia" | "local";

// Single-sourced from the installer command registry shared with the
// Electron main process (electron/installer-commands.json).
export type InstallerCommand = keyof typeof installerCommands;

export type VoiceKeyName = "ASSEMBLY_AI_API_KEY" | "CARTESIA_API_KEY";

// The `audio` block from the CLI's GET /api/onboarding/status/: the selected
// audio provider (from the dispatcher config, the source of truth) and
// whether its provider keys are present in the runtime env file.
export type CliAudioStatus = {
  keys: Partial<Record<VoiceKeyName, boolean>>;
  provider: string;
  voice_ready: boolean;
};

// The `tailscale_self` block from the CLI's onboarding status: the single
// implementation of the local Tailscale identity check. Reached over HTTP
// when the backend is healthy, or via the CLI binary before services run.
export type CliTailscaleSelf = {
  available?: boolean;
  dns_name?: string | null;
  error?: string | null;
  ips?: string[];
  node_hostname?: string | null;
  tailnet?: string | null;
  tailscale_available?: boolean;
};

// The `tailscale_serve` block from the CLI's onboarding status.
export type CliTailscaleServe = {
  error?: string | null;
  healthy?: boolean;
  openbase_url?: string | null;
};

export type LoginStatus = {
  authenticated: boolean;
  /** Human-readable reason when the login is expired or unvalidated. */
  detail?: string;
  email?: string;
  /** Auth file path; only display fallbacks rely on it now. */
  path?: string;
  status?: "logged_in" | "logged_out" | "login_expired";
  /** False when Openbase Cloud was unreachable and presence was assumed. */
  validated?: boolean;
};

// The `backend_auth` block from the CLI's GET /api/onboarding/status/:
// whether the selected coding backend can start sessions without an
// interactive login. `backend` is a CLI backend id (codex, claude_code,
// openbase_cloud); unknown values must be tolerated.
export type BackendAuthStatus = {
  backend: string;
  ready: boolean;
};

export type CloudOnboardingDevice = {
  capabilities?: Record<string, unknown>;
  device_id?: string;
  display_name?: string;
  has_tailscale?: boolean;
  hostname?: string;
  kind?: string;
  last_seen?: string;
  tailscale?: Record<string, unknown> | null;
  tailscale_ip?: string | null;
  tailscale_magic_dns?: string;
  tailnet?: string;
};

export type CloudOnboardingMissingFact = {
  code?: string;
  message?: string;
};

export type CloudOnboardingKindDiagnostics = {
  has_registered?: boolean;
  has_tailscale?: boolean;
  registered_count?: number;
  tailscale_count?: number;
  tailnets?: string[];
};

export type CloudOnboardingDiagnostics = {
  desktop?: CloudOnboardingKindDiagnostics;
  missing_facts?: CloudOnboardingMissingFact[];
  mobile?: CloudOnboardingKindDiagnostics;
  paired?: boolean;
  tailnets_compatible?: boolean;
};

export type CloudOnboardingState = {
  diagnostics?: CloudOnboardingDiagnostics;
  desktop_count?: number;
  devices?: CloudOnboardingDevice[];
  mobile_count?: number;
};

export type TailscaleIdentityStatus = {
  connected: boolean;
  dnsName?: string | null;
  error?: string | null;
  hostName?: string | null;
  installed: boolean;
  ip?: string | null;
  ok: boolean;
  tailnet?: string | null;
};

export type SetupStepStatus = "start" | "ok" | "warn" | "error";

export type SetupSteps = Record<string, { detail: string | null; status: SetupStepStatus }>;

export type SetupProgressEvent =
  | { detail?: string | null; event: "step"; id: string; status: SetupStepStatus }
  | {
      cli_configured?: boolean;
      event: "result";
      ok: boolean;
      tailscale_serve_healthy?: boolean;
    };

export type InstallerEvent =
  | {
      commandId: InstallerCommand;
      commandText: string;
      type: "start";
    }
  | {
      commandId: InstallerCommand;
      stream: "stdout" | "stderr";
      text: string;
      type: "output";
    }
  | {
      code: number | null;
      commandId: InstallerCommand;
      signal: string | null;
      type: "exit";
    }
  | {
      commandId: InstallerCommand;
      error: string;
      type: "error";
    };

export type Prerequisite = {
  action?: "connect-tailscale" | "open-tailscale";
  detail: string;
  id: string;
  label: string;
  ok: boolean;
};

export type InstallerCheck = {
  platform: string;
  prerequisites: Prerequisite[];
};

export type AppUpdateState = {
  error: string | null;
  status: "idle" | "checking" | "downloading" | "downloaded" | "up-to-date" | "error";
  version: string | null;
};

export type AppUpdatesApi = {
  check(): Promise<{ error?: string; ok: boolean; state?: AppUpdateState }>;
  onEvent(callback: (state: AppUpdateState) => void): () => void;
  quitAndInstall(): Promise<{ error?: string; ok: boolean }>;
  status(): Promise<{ appVersion?: string; ok: boolean; state?: AppUpdateState }>;
};

// The `versions` block from the CLI's GET /api/onboarding/status/ (see the
// workspace AUTO_UPDATE.md version handshake).
export type CliVersions = {
  channel?: string;
  cli?: string;
  latest_version?: string;
  layout_version?: number;
  package_version?: string;
  standalone?: boolean;
  target?: string;
  update_available?: boolean;
  update_required?: boolean;
};

export type DesktopControlState = {
  error: string | null;
  port: number | null;
  status: "starting" | "running" | "error";
};

export type DesktopControlApi = {
  onEvent(callback: (state: DesktopControlState) => void): () => void;
  status(): Promise<{ ok: boolean; state?: DesktopControlState }>;
};

export type DeepLinkPayload = {
  action?: string;
  intent?: string;
  source?: string;
};

export type DeepLinkApi = {
  onOpen(callback: (payload: DeepLinkPayload) => void): () => void;
};

export type InstallerApi = {
  platform: string;
  cancel(): Promise<{ ok: boolean; running: boolean }>;
  check(): Promise<InstallerCheck>;
  /**
   * The CLI's `tailscale_self` onboarding fact, read by running the CLI
   * binary (`onboarding status --json`) — the pre-backend access path to
   * the same single implementation the HTTP status payload reports.
   */
  tailscaleIdentity(): Promise<{
    error?: string;
    ok: boolean;
    self?: CliTailscaleSelf | null;
  }>;
  /** This machine's materialized tailnet transport from the CLI env file. */
  tailnetProvider(): Promise<{
    error?: string;
    ok: boolean;
    provider: TailnetProviderChoice;
    options?: TailnetExperience[];
  }>;
  /** Netmesh VPN companion (macOS): the embedded full-device VPN driver. */
  netmeshStatus(): Promise<NetmeshCompanionStatus>;
  netmeshRegister(): Promise<NetmeshCompanionStatus>;
  netmeshConnect(): Promise<NetmeshCompanionStatus>;
  netmeshDisconnect(): Promise<NetmeshCompanionStatus>;
  connectLinuxTailscale(): Promise<{
    authUrlOpened?: boolean;
    error?: string;
    ok: boolean;
    registrationCompleted?: boolean;
    registrationFailed?: boolean;
    supported: boolean;
  }>;
  onboardingFlags(): Promise<Record<string, unknown>>;
  setOnboardingFlag(
    key: string,
    value: unknown,
  ): Promise<{ error?: string; ok: boolean }>;
  onEvent(callback: (event: InstallerEvent) => void): () => void;
  openTailscaleApp(): Promise<{ error?: string; ok: boolean; opened?: "app" | "download" }>;
  openTailscaleDownload(): Promise<{ error?: string; ok: boolean }>;
  start(
    commandId: InstallerCommand,
    options?: {
      audioProvider?: AudioProviderChoice;
      backend?: BackendChoice;
      fastMode?: boolean;
      linkClaudeConfig?: boolean;
      linkCodexConfig?: boolean;
    },
  ): Promise<{ commandText?: string; error?: string; ok: boolean }>;
};

export type OnboardingPage =
  | "welcome"
  | "prerequisites"
  | "setup"
  | "backendAuth"
  | "voiceKeys"
  | "login"
  | "mobile"
  | "pairing"
  | "verify";

export type TailnetProviderChoice = "tailscale" | "netmesh" | "netmesh-tsnet";

export type TailnetExperience = {
  browser_site_access: boolean;
  electron_onboarding: boolean;
  electron_platforms: string[];
  name: string;
  provider: TailnetProviderChoice;
  recommended: boolean;
  requires_vpn: boolean;
  summary: string;
};

// Response shape of the netmesh companion IPC calls: SMAppService state plus
// the engine status when the daemon is reachable.
export type NetmeshCompanionStatus = {
  ok: boolean;
  available?: boolean;
  helper:
    | "enabled"
    | "requiresApproval"
    | "notRegistered"
    | "notFound"
    | "unavailable"
    | "unknown";
  backendState?: string;
  selfIP?: string;
  dnsName?: string;
  error?: string;
};

export type StartCommandOptions = {
  audioProvider?: AudioProviderChoice;
  backend?: BackendChoice;
  fastMode?: boolean;
  linkClaudeConfig?: boolean;
  linkCodexConfig?: boolean;
  /** tailnetSetProvider command: which transport to switch this machine to. */
  provider?: TailnetProviderChoice;
  /** setup command: initial tailnet transport for a fresh env file. */
  tailnetProvider?: TailnetProviderChoice;
};

export type StartCommand = (
  commandId: InstallerCommand,
  options?: StartCommandOptions,
) => Promise<void>;

export type SelectableOption<Id extends string> = {
  description: string;
  disabledReason?: string;
  id: Id;
  label: string;
  summary: string;
};

declare global {
  interface Window {
    __OPENBASE_APP_UPDATES__?: AppUpdatesApi;
    __OPENBASE_DEEP_LINKS__?: DeepLinkApi;
    __OPENBASE_DESKTOP_CONTROL__?: DesktopControlApi;
    __OPENBASE_INSTALLER__?: InstallerApi;
    __OPENBASE_RUNTIME_CONFIG__?: RuntimeConfig;
  }
}
