import { useState } from "react";

import {
  isProductAnalyticsEnabled,
  setProductAnalyticsEnabled,
} from "./analytics";

export function ProductAnalyticsPreference() {
  const [enabled, setEnabled] = useState(isProductAnalyticsEnabled);

  return (
    <label className="fixed bottom-4 right-4 z-40 flex max-w-xs cursor-pointer items-start gap-2 rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 text-[11px] text-zinc-600 shadow-md backdrop-blur">
      <input
        checked={enabled}
        className="mt-0.5"
        onChange={(event) => {
          setProductAnalyticsEnabled(event.target.checked);
          setEnabled(isProductAnalyticsEnabled());
        }}
        type="checkbox"
      />
      <span>
        <span className="block font-medium text-zinc-800">Share anonymous product usage</span>
        Off until you opt in. Never includes prompts, code, audio, file paths,
        or repository content.
      </span>
    </label>
  );
}
