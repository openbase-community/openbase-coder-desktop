/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AMPLITUDE_API_KEY?: string;
  readonly VITE_AMPLITUDE_ENDPOINT?: string;
  readonly VITE_PRODUCT_ANALYTICS_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

type OpenbaseLiveKitCompanionSession = {
  roomUrl: string;
  companionToken: string;
  companionTokenExpiresAt?: string;
};

interface WindowEventMap {
  "openbase:livekit-companion-session": CustomEvent<OpenbaseLiveKitCompanionSession | null>;
}

interface Window {
  __openbaseNativeAuth?: {
    getToken: () => Promise<string>;
  };
}
