import { describe, expect, it } from "vitest";

import { applyTailscaleConnectionPrerequisite } from "./tailscaleConnectionPrerequisite";
import type { Prerequisite, TailscaleIdentityStatus } from "./types";

const installed: Prerequisite[] = [
  { detail: "Logged out.", id: "tailscale", label: "Tailscale", ok: true },
];

const identity = (
  overrides: Partial<TailscaleIdentityStatus> = {},
): TailscaleIdentityStatus => ({
  connected: false,
  installed: true,
  ok: false,
  ...overrides,
});

describe("applyTailscaleConnectionPrerequisite", () => {
  it("blocks macOS setup and offers the existing Tailscale app while logged out", () => {
    expect(applyTailscaleConnectionPrerequisite(installed, "darwin", identity())).toEqual([
      {
        action: "open-tailscale",
        detail:
          "Tailscale is installed but not connected. Open Tailscale and sign in before setup so Tailscale Serve can be configured.",
        id: "tailscale",
        label: "Tailscale",
        ok: false,
      },
    ]);
  });

  it("blocks Linux setup and offers managed connection while logged out", () => {
    expect(applyTailscaleConnectionPrerequisite(installed, "linux", identity())).toEqual([
      {
        action: "connect-tailscale",
        detail:
          "Tailscale is installed but not connected. Connect here before setup so Tailscale Serve can be configured.",
        id: "tailscale",
        label: "Tailscale",
        ok: false,
      },
    ]);
  });

  it.each(["darwin", "linux"])("allows %s setup after Tailscale connects", (platform) => {
    expect(
      applyTailscaleConnectionPrerequisite(
        installed,
        platform,
        identity({ connected: true, dnsName: "devspace-example.tail.example.ts.net" }),
      ),
    ).toEqual([
      {
        detail: "Connected to Tailscale as devspace-example.tail.example.ts.net.",
        id: "tailscale",
        label: "Tailscale",
        ok: true,
      },
    ]);
  });

  it("keeps the download action when Tailscale is absent", () => {
    const missing = [
      { detail: "Tailscale is not installed.", id: "tailscale", label: "Tailscale", ok: false },
    ];
    expect(applyTailscaleConnectionPrerequisite(missing, "darwin", null)).toEqual(missing);
    expect(applyTailscaleConnectionPrerequisite(missing, "linux", null)).toEqual(missing);
  });

  it("does not alter unsupported platforms", () => {
    expect(applyTailscaleConnectionPrerequisite(installed, "win32", identity())).toBe(installed);
  });
});
