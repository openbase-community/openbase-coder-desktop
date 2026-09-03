import installerCommands from "../../electron/installer-commands.json";
import runtimeDefaults from "../../electron/runtime-defaults.json";

import type {
  AudioProviderChoice,
  BackendChoice,
  InstallerCommand,
  SelectableOption,
  SetupProgressEvent,
} from "./types";

export const NORMAL_ONBOARDING_BACKEND: BackendChoice = "openbase-cloud";
export const NORMAL_ONBOARDING_AUDIO_PROVIDER: AudioProviderChoice = "openbase-cloud";
export const DEFAULT_SETUP_BACKEND: BackendChoice = NORMAL_ONBOARDING_BACKEND;
export const DEFAULT_AUDIO_PROVIDER: AudioProviderChoice = NORMAL_ONBOARDING_AUDIO_PROVIDER;
export const BASE_SETUP_COMMAND = "openbase-coder setup";
export const shareConfigFlag = (backend: BackendChoice) =>
  backend === "claude-code" || backend === "openbase-cloud"
    ? "--link-claude-config"
    : "--link-codex-config";
export const setupCommandText = (
  backend: BackendChoice = DEFAULT_SETUP_BACKEND,
  audioProvider: AudioProviderChoice = DEFAULT_AUDIO_PROVIDER,
  shareAgentConfig = false,
  fastMode = true,
) =>
  `${BASE_SETUP_COMMAND} --backend ${backend} --audio-provider ${audioProvider}${
    shareAgentConfig ? ` ${shareConfigFlag(backend)}` : ""
  }${fastMode ? "" : " --no-fast-mode"}`;
export const REQUIRED_PREREQUISITE_IDS = ["platform", "openbase-coder", "tailscale"];
export const MAX_TERMINAL_LINES = 1000;
// App Store listing is TestFlight-only for now; openbase.cloud redirects there.
export const MOBILE_APP_DOWNLOAD_URL = "https://openbase.cloud/ios";
// Default macOS Tailscale install path: the Mac App Store variant. Its
// sandboxed network extension avoids the standalone variant's
// system-extension breakage after Tailscale/macOS updates (login loops,
// Tailscale.CLIError), and it supports everything Openbase needs —
// port-mode Tailscale Serve, the bundled CLI, and MagicDNS. The site
// download (tailscale.com/download/mac) remains a fallback for machines
// without App Store access; never install both variants at once.
export const TAILSCALE_MAC_APP_STORE_URL =
  "https://apps.apple.com/us/app/tailscale/id1475387142";
export const CLOUD_STATE_POLL_INTERVAL_MS = 4000;
// Upper bound on the launch loading screen shown while the status probes
// settle (see deriveLaunchSettling); a hung probe falls through to the
// onboarding shell rather than a stuck spinner.
export const LAUNCH_SETTLE_TIMEOUT_MS = 10000;
// Durable user-intent flags stored with the installation in
// ~/.openbase/desktop-onboarding.json (installer onboardingFlags /
// setOnboardingFlag IPC), so wiping the Openbase home resets onboarding.
export const PAIRING_ACKNOWLEDGED_FLAG = "pairingAcknowledged";
// Linux onboarding runs inside a cloud desktop whose local services may be
// restarted from the console. Once the full flow has completed, keep those
// ordinary runtime restarts from reopening first-run setup. This is
// intentionally Linux-only; the established macOS onboarding behavior does
// not read or write this flag.
export const LINUX_ONBOARDING_COMPLETED_FLAG = "linuxOnboardingCompleted";
// Dev/testing escape hatch: keeps the onboarding shell visible even on a
// fully configured machine so the waiting states stay observable. Enable
// from the devtools console with
//   localStorage.setItem("openbase-force-onboarding", "1")
// then reload; remove the key to restore normal gating.
export const FORCE_ONBOARDING_STORAGE_KEY = "openbase-force-onboarding";

export const SETUP_STEP_LABELS: Record<string, string> = {
  workspace: "Prepare runtime assets",
  installation_config: "Write installation config",
  env: "Generate environment file",
  agent_config: "Configure agent homes",
  services: "Install background services",
  tailscale_serve: "Configure Tailscale Serve",
};

export const fallbackCommands = [
  "curl -fsSL https://github.com/openbase-community/openbase/releases/latest/download/install.sh | sh",
  `open ${TAILSCALE_MAC_APP_STORE_URL}`,
  setupCommandText(),
  "openbase-coder doctor",
];

export const backendOptions: SelectableOption<BackendChoice>[] = [
  {
    id: "codex",
    label: "Codex",
    summary: "OpenAI models, or local models with extra setup.",
    description:
      "Reuses your Codex CLI sign-in (codex login): setup links it into Openbase's separate Codex home. Requires an OpenAI subscription for hosted models; local models like Qwen need additional Codex/Ollama setup and powerful hardware.",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    summary: "Anthropic Claude Code backend.",
    description:
      "Reuses your Claude Code CLI sign-in: setup copies it into Openbase's separate Claude config, and signs in there only if none is found. Requires an Anthropic subscription.",
  },
  {
    id: "openbase-cloud",
    label: "Openbase Cloud",
    summary: "Managed Claude Code through Openbase Cloud.",
    description:
      "Starts with a generous Openbase Cloud free trial. Runs managed Claude Code through the Openbase Cloud proxy without a personal Anthropic account.",
  },
];

export const existingMachineBackendOptions: SelectableOption<BackendChoice>[] =
  backendOptions.filter((option) =>
    option.id === "codex" || option.id === "claude-code",
  );

export const audioProviderOptions: SelectableOption<AudioProviderChoice>[] = [
  {
    id: "openbase-cloud",
    label: "Openbase Cloud",
    summary: "Managed STT/TTS.",
    description:
      "Included with the Openbase Cloud trial. Uses managed speech-to-text and text-to-speech without third-party audio keys.",
  },
  {
    id: "cartesia",
    label: "Provider keys",
    summary: "Bring AssemblyAI and Cartesia.",
    description:
      "Uses your own AssemblyAI key for speech-to-text and Cartesia key for text-to-speech.",
  },
  {
    id: "local",
    label: "Local audio (Dev setup only)",
    summary: "Disabled in onboarding.",
    description:
      "Local MLX Whisper and Kokoro currently require a developer-managed runtime and should not be used for first-run setup.",
    disabledReason: "Dev setup only",
  },
];

export function getBackendBaseUrl() {
  return window.__OPENBASE_RUNTIME_CONFIG__?.backendBaseUrl ?? runtimeDefaults.backendBaseUrl;
}

export function commandLabel(command: InstallerCommand) {
  return installerCommands[command].label;
}

export function parseSetupProgressEvent(line: string): SetupProgressEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !("event" in parsed)) {
    return null;
  }
  const event = parsed as SetupProgressEvent;
  return event.event === "step" || event.event === "result" ? event : null;
}
