import { describe, expect, it } from "vitest";

import { applyTailscaleConnectionPrerequisite } from "./tailscaleConnectionPrerequisite";
import type { Prerequisite } from "./types";

const installed: Prerequisite[] = [
  {
    detail: "Choose a network.",
    id: "private-network",
    label: "Private networking",
    ok: false,
  },
];

describe("applyTailscaleConnectionPrerequisite", () => {
  it("blocks the Tailscale-app compatibility provider in Electron onboarding", () => {
    expect(applyTailscaleConnectionPrerequisite(installed, "darwin", null)).toEqual([
      {
        action: undefined,
        detail: "Choose Openbase VPN or Openbase Direct before setup.",
        id: "private-network",
        label: "Private networking",
        ok: false,
      },
    ]);
  });

  it.each([
    ["netmesh", "Openbase VPN selected"],
    ["netmesh-tsnet", "Openbase Direct selected"],
  ] as const)("accepts the %s Openbase transport", (provider, detail) => {
    const result = applyTailscaleConnectionPrerequisite(
      installed,
      "darwin",
      null,
      provider,
    );
    expect(result[0]).toMatchObject({ label: "Private networking", ok: true });
    expect(result[0].detail).toContain(detail);
  });
});
