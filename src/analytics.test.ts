import { afterEach, describe, expect, it, vi } from "vitest";

import {
  identifyAnalyticsUser,
  isAllowedAnalyticsEvent,
  productAnalyticsCollectionEnabled,
  sanitizeAnalyticsProperties,
  setProductAnalyticsEnabled,
  type AuthenticatedFetch,
} from "./analytics";

afterEach(() => vi.unstubAllGlobals());

function stubWindowStorage(entries: Record<string, string> = {}) {
  const values = new Map<string, string>(Object.entries(entries));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  return values;
}

describe("sanitizeAnalyticsProperties", () => {
  it("keeps approved scalar measurements", () => {
    expect(
      sanitizeAnalyticsProperties({
        step_id: "pairing",
        duration_ms: 4200,
        response_duration_ms: 900,
        is_retryable: true,
        outcome: null,
        harmless_but_unknown: "must not leave the client",
      }),
    ).toEqual({
      step_id: "pairing",
      duration_ms: 4200,
      response_duration_ms: 900,
      is_retryable: true,
      outcome: null,
    });
  });

  it("drops content and credential-shaped properties", () => {
    expect(
      sanitizeAnalyticsProperties({
        prompt: "fix my source",
        response: "private model output",
        transcript_text: "spoken words",
        repository_name: "private-repo",
        api_key: "secret",
        raw_error_message: "sensitive server response",
        error_code: "pairing_unavailable",
        user_id: "user-1",
        email: "private@example.com",
        username: "private-user",
      }),
    ).toEqual({ error_code: "pairing_unavailable" });
  });

  it("accepts only canonical event names", () => {
    expect(isAllowedAnalyticsEvent("voice_call_connected")).toBe(true);
    expect(isAllowedAnalyticsEvent("private_prompt_copied")).toBe(false);
  });

  it("requires opt-in and honors privacy and build kill switches", () => {
    expect(productAnalyticsCollectionEnabled(true, null, false)).toBe(false);
    expect(productAnalyticsCollectionEnabled(true, "1", false)).toBe(true);
    expect(productAnalyticsCollectionEnabled(true, "0", false)).toBe(false);
    expect(productAnalyticsCollectionEnabled(false, "1", false)).toBe(false);
    expect(productAnalyticsCollectionEnabled(true, "1", true)).toBe(false);
  });

  it("does not create an analytics identifier before an allowed send", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });

    setProductAnalyticsEnabled(true);
    expect(values.get("openbase.analytics.enabled")).toBe("1");
    expect(values.has("openbase.analytics.device_id")).toBe(false);

    values.set("openbase.analytics.device_id", "prior-opt-in-id");
    setProductAnalyticsEnabled(false);
    expect(values.has("openbase.analytics.device_id")).toBe(false);
  });
});

describe("identifyAnalyticsUser", () => {
  it("does not call the cloud API while analytics is opted out", async () => {
    stubWindowStorage({ "openbase.analytics.enabled": "0" });
    const fetchMock = vi.fn();
    await identifyAnalyticsUser(fetchMock as unknown as AuthenticatedFetch);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the Amplitude device id to the identify endpoint when opted in", async () => {
    stubWindowStorage({ "openbase.analytics.enabled": "1" });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ analytics_key: "acct-key-123" }),
    }));

    await identifyAnalyticsUser(fetchMock as unknown as AuthenticatedFetch);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toBe("/api/openbase/analytics/identify");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as { amplitude_device_id: string };
    expect(typeof body.amplitude_device_id).toBe("string");
    expect(body.amplitude_device_id.length).toBeGreaterThanOrEqual(5);
  });

  it("stays silent when the identify request throws", async () => {
    stubWindowStorage({ "openbase.analytics.enabled": "1" });
    const fetchMock = vi.fn(async () => {
      throw new Error("network unreachable");
    });
    await expect(
      identifyAnalyticsUser(fetchMock as unknown as AuthenticatedFetch),
    ).resolves.toBeUndefined();
  });
});
