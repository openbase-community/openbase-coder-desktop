export type AnalyticsProperty = string | number | boolean | null;
export type AnalyticsProperties = Record<string, AnalyticsProperty | undefined>;

const DEFAULT_ENDPOINT = "https://api2.amplitude.com/2/httpapi";
const DEVICE_ID_KEY = "openbase.analytics.device_id";
const PRODUCT_ANALYTICS_ENABLED_KEY = "openbase.analytics.enabled";
const MAX_STRING_LENGTH = 160;
// Must match the canonical taxonomy in the Openbase Cloud API.
const ALLOWED_EVENT_TYPES = new Set([
  "app_session_started",
  "onboarding_started",
  "onboarding_step_viewed",
  "onboarding_step_completed",
  "onboarding_step_failed",
  "onboarding_completed",
  "onboarding_skipped",
  "approval_resolved",
  "voice_call_started",
  "voice_call_connected",
  "voice_call_ended",
  "diff_reviewed",
]);
const ALLOWED_PROPERTY_KEYS = new Set([
  "action",
  "app_version",
  "call_id",
  "completion_method",
  "connect_duration_ms",
  "connected",
  "decision",
  "direction",
  "duration_ms",
  "entry_mode",
  "environment",
  "error_code",
  "event_schema_version",
  "is_retryable",
  "launch_source",
  "outcome",
  "platform",
  "request_type",
  "response_duration_ms",
  "step_count",
  "step_id",
  "step_index",
  "surface",
]);

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function storedDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing && existing.length >= 5) return existing;
    const created = randomId();
    window.localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return randomId();
  }
}

export function sanitizeAnalyticsProperties(
  properties: AnalyticsProperties,
): Record<string, AnalyticsProperty> {
  const sanitized: Record<string, AnalyticsProperty> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!ALLOWED_PROPERTY_KEYS.has(key) || value === undefined) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    if (typeof value === "string") {
      sanitized[key] = value.slice(0, MAX_STRING_LENGTH);
    } else if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function isAllowedAnalyticsEvent(eventType: string): boolean {
  return ALLOWED_EVENT_TYPES.has(eventType);
}

export function productAnalyticsCollectionEnabled(
  buildEnabled: boolean,
  storedPreference: string | null,
  doNotTrack: boolean,
): boolean {
  return buildEnabled && storedPreference === "1" && !doNotTrack;
}

export function browserDoNotTrackEnabled(): boolean {
  if (typeof navigator === "undefined") return false;
  const globalPrivacyControl = (
    navigator as Navigator & { globalPrivacyControl?: boolean }
  ).globalPrivacyControl;
  return navigator.doNotTrack === "1" || globalPrivacyControl === true;
}

export function isProductAnalyticsEnabled(): boolean {
  const buildEnabled = import.meta.env.VITE_PRODUCT_ANALYTICS_ENABLED !== "0";
  try {
    return productAnalyticsCollectionEnabled(
      buildEnabled,
      window.localStorage.getItem(PRODUCT_ANALYTICS_ENABLED_KEY),
      browserDoNotTrackEnabled(),
    );
  } catch {
    return false;
  }
}

export function setProductAnalyticsEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(PRODUCT_ANALYTICS_ENABLED_KEY, enabled ? "1" : "0");
    if (!enabled) window.localStorage.removeItem(DEVICE_ID_KEY);
  } catch {
    // A blocked storage backend must not make the preference control fail.
  }
  if (enabled) {
    productAnalytics.trackSessionStartedOnce("analytics_opt_in");
  } else {
    productAnalytics.resetSessionTracking();
  }
}

class ProductAnalytics {
  private readonly apiKey = import.meta.env.VITE_AMPLITUDE_API_KEY?.trim();
  private readonly endpoint =
    import.meta.env.VITE_AMPLITUDE_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
  private readonly sessionId = Date.now();
  private didTrackSession = false;

  track(eventType: string, properties: AnalyticsProperties = {}): boolean {
    if (
      !this.apiKey ||
      !isProductAnalyticsEnabled() ||
      !isAllowedAnalyticsEvent(eventType)
    ) return false;

    const eventProperties = sanitizeAnalyticsProperties({
      event_schema_version: 1,
      platform: "desktop",
      surface: "desktop",
      environment: import.meta.env.MODE,
      ...properties,
    });
    const payload = {
      api_key: this.apiKey,
      events: [
        {
          device_id: storedDeviceId(),
          event_type: eventType,
          event_properties: eventProperties,
          insert_id: randomId(),
          session_id: this.sessionId,
          time: Date.now(),
        },
      ],
    };

    void fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Product analytics is always best-effort and must never affect the app.
    });
    return true;
  }

  trackSessionStartedOnce(launchSource = "app_launch"): void {
    if (this.didTrackSession) return;
    if (this.track("app_session_started", { launch_source: launchSource })) {
      this.didTrackSession = true;
    }
  }

  resetSessionTracking(): void {
    this.didTrackSession = false;
  }
}

export const productAnalytics = new ProductAnalytics();
