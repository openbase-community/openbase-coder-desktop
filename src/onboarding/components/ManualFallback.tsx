import { Clipboard } from "lucide-react";

import { fallbackCommands } from "../config";

export function ManualFallback() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
        <Clipboard aria-hidden className="h-4 w-4" />
        Developer fallback
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200 bg-white px-3 py-2">
        {fallbackCommands.map((command) => (
          <code key={command} className="block whitespace-pre py-0.5 font-mono text-xs text-zinc-800">
            {command}
          </code>
        ))}
      </div>
    </div>
  );
}
