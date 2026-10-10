import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WelcomePage } from "./WelcomePage";

describe("WelcomePage", () => {
  const html = renderToStaticMarkup(<WelcomePage onContinue={() => {}} />);

  it("keeps the welcome heading and the continue button", () => {
    expect(html).toContain("Welcome to Openbase");
    expect(html).toContain("get you set up");
  });

  it("drops the step checklist and the extra copy", () => {
    for (const removed of ["Install the CLI", "Pair privately", "Take your time", "managed"]) {
      expect(html).not.toContain(removed);
    }
  });
});
