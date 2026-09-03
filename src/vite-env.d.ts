/// <reference types="vite/client" />

type OpenbaseLiveKitCompanionSession = {
  roomUrl: string;
  companionToken: string;
  companionTokenExpiresAt?: string;
};

interface WindowEventMap {
  "openbase:livekit-companion-session": CustomEvent<OpenbaseLiveKitCompanionSession | null>;
}
