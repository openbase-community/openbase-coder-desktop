import { ArrowRight, KeyRound, Loader2, RefreshCw, Save } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { PageShell } from "../components/PageShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { SecondaryButton } from "../components/SecondaryButton";
import { StatusIcon } from "../components/StatusIcon";
import type {
  AudioProviderChoice,
  CliAudioStatus,
  SelectableOption,
  StartCommand,
  VoiceKeyName,
} from "../types";

export function VoiceKeysPage({
  audio,
  canRunUtilities,
  commandError,
  onContinue,
  onSaveVoiceKeys,
  onStartCommand,
  selectedAudioProvider,
  selectedAudioProviderOption,
  setVoiceKeyInputs,
  voiceConfigured,
  voiceKeyError,
  voiceKeyInputs,
  voiceKeysJustSaved,
  voiceKeysSaving,
}: {
  audio: CliAudioStatus | null;
  canRunUtilities: boolean;
  commandError: string | null;
  onContinue: () => void;
  onSaveVoiceKeys: () => Promise<void>;
  onStartCommand: StartCommand;
  selectedAudioProvider: AudioProviderChoice;
  selectedAudioProviderOption: SelectableOption<AudioProviderChoice>;
  setVoiceKeyInputs: Dispatch<SetStateAction<Record<VoiceKeyName, string>>>;
  voiceConfigured: boolean;
  voiceKeyError: string | null;
  voiceKeyInputs: Record<VoiceKeyName, string>;
  voiceKeysJustSaved: boolean;
  voiceKeysSaving: boolean;
}) {
  return (
    <PageShell
      eyebrow="Step 5"
      heading="Configure voice audio"
      support={
        selectedAudioProvider === "cartesia"
            ? "Provider-key audio uses AssemblyAI for speech-to-text and Cartesia for text-to-speech. Keys are written to the local Openbase env file and never displayed back."
            : selectedAudioProvider === "local"
              ? "Local audio uses MLX Whisper for speech-to-text and Kokoro for text-to-speech. Setup downloads the local models for this Mac."
              : "Openbase Cloud audio is included with the Openbase Cloud trial. Managed speech-to-text and voice output work without third-party audio keys."
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {selectedAudioProvider === "cartesia" ? (
            <div className="space-y-3">
              {(
                [
                  {
                    name: "ASSEMBLY_AI_API_KEY" as const,
                    label: "AssemblyAI API key",
                    hint: "Used for streaming speech-to-text.",
                    placeholder: "Paste AssemblyAI key",
                  },
                  {
                    name: "CARTESIA_API_KEY" as const,
                    label: "Cartesia API key",
                    hint: "Used for streaming text-to-speech.",
                    placeholder: "Paste Cartesia key",
                  },
                ]
              ).map((field) => {
                const configured = audio?.keys[field.name] ?? false;
                return (
                  <div
                    className="rounded-xl border border-zinc-200 bg-zinc-50 p-4"
                    key={field.name}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-zinc-950">
                        <KeyRound aria-hidden className="h-4 w-4 text-zinc-500" />
                        {field.label}
                      </div>
                      <div className="inline-flex items-center gap-1.5 text-xs text-zinc-600">
                        <StatusIcon ok={configured} />
                        {configured ? "Configured" : "Missing"}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-zinc-600">{field.hint}</div>
                    <input
                      autoComplete="off"
                      className="mt-3 block h-9 w-full rounded-xl border border-zinc-300 bg-white px-3 font-mono text-sm text-zinc-900 outline-none focus:border-emerald-600"
                      disabled={voiceKeysSaving}
                      onChange={(event) =>
                        setVoiceKeyInputs((current) => ({
                          ...current,
                          [field.name]: event.target.value,
                        }))
                      }
                      placeholder={
                        configured ? "Leave blank to keep current value" : field.placeholder
                      }
                      spellCheck={false}
                      type="password"
                      value={voiceKeyInputs[field.name]}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-950">
                <StatusIcon ok />
                {selectedAudioProviderOption.label}
              </div>
              <div className="mt-2 text-sm leading-6 text-zinc-700">
                {selectedAudioProviderOption.description}
              </div>
            </div>
          )}

          {commandError && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
              {commandError}
            </div>
          )}
          {voiceKeyError && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
              {voiceKeyError}
            </div>
          )}
          {voiceKeysJustSaved && !voiceKeyError && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Voice keys saved. Restart the backend if it was already running.
            </div>
          )}
        </div>

        <aside className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="text-sm font-medium text-zinc-950">Voice selection</div>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Provider</dt>
              <dd className="mt-1 text-zinc-800">{selectedAudioProviderOption.label}</dd>
            </div>
            {selectedAudioProvider === "cartesia" ? (
              <>
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Env file</dt>
                  <dd className="mt-1 break-words font-mono text-xs text-zinc-800">
                    ~/.openbase/.env
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Visibility</dt>
                  <dd className="mt-1 text-zinc-800">
                    Saved values are never shown back to the UI.
                  </dd>
                </div>
              </>
            ) : (
              <div>
                <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Keys</dt>
                <dd className="mt-1 text-zinc-800">No third-party audio keys needed</dd>
              </div>
            )}
          </dl>
        </aside>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {selectedAudioProvider === "cartesia" && (
          <PrimaryButton disabled={voiceKeysSaving} onClick={() => void onSaveVoiceKeys()}>
            {voiceKeysSaving ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <Save aria-hidden className="h-4 w-4" />
            )}
            Save keys
          </PrimaryButton>
        )}
        <SecondaryButton
          disabled={!canRunUtilities || !voiceConfigured}
          onClick={() => void onStartCommand("restartBackend")}
        >
          <RefreshCw aria-hidden className="h-4 w-4" />
          Restart services
        </SecondaryButton>
        <PrimaryButton disabled={!voiceConfigured} onClick={onContinue}>
          Continue to sign in
          <ArrowRight aria-hidden className="h-4 w-4" />
        </PrimaryButton>
      </div>
    </PageShell>
  );
}
