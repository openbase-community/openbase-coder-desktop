import { ChevronRight, Terminal } from "lucide-react";
import type { ReactNode } from "react";

export function AdvancedDetails({ children }: { children?: ReactNode }) {
  return (
    <details className="group rounded-xl border border-zinc-200 bg-zinc-50">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-zinc-800 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="h-4 w-4 text-zinc-500 transition-transform group-open:rotate-90"
        />
        Advanced
      </summary>
      <div className="space-y-4 border-t border-zinc-200 px-4 py-4">
        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
            <Terminal aria-hidden className="h-4 w-4 text-zinc-500" />
            Diagnose a failure with your coding agent
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-600">
            Openbase uses <code className="font-mono">~/.openbase</code> as its
            runtime working directory. If something is failing, open Terminal,
            run <code className="font-mono">cd ~/.openbase</code>, then launch
            <code className="font-mono"> codex</code> or
            <code className="font-mono"> claude</code> from that directory and
            ask it to diagnose the failure.
          </p>
        </div>
        {children}
      </div>
    </details>
  );
}
