import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

import { SETUP_STEP_LABELS } from "../config";
import { calmSpring } from "../motion";
import type { SetupSteps } from "../types";

export function SetupStepChecklist({ steps }: { steps: SetupSteps }) {
  const entries = Object.keys(SETUP_STEP_LABELS)
    .filter((id) => steps[id])
    .map((id) => ({ id, label: SETUP_STEP_LABELS[id], ...steps[id] }));
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200/80 bg-white">
      {entries.map((entry) => (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-3 px-4 py-3 ${
            entry.status === "start" ? "bg-[#18498B]/[0.04]" : ""
          }`}
          initial={{ opacity: 0, y: 8 }}
          key={entry.id}
          transition={calmSpring}
        >
          {entry.status === "start" ? (
            <Loader2
              aria-hidden
              className="h-5 w-5 shrink-0 animate-spin text-[#18498B]"
            />
          ) : entry.status === "ok" ? (
            <CheckCircle2 aria-hidden className="h-4 w-4 text-emerald-500" />
          ) : (
            <AlertCircle
              aria-hidden
              className={`h-4 w-4 ${entry.status === "warn" ? "text-amber-500" : "text-red-500"}`}
            />
          )}
          <div className="min-w-0">
            <div className="text-sm text-zinc-950">{entry.label}</div>
            {entry.detail && entry.status !== "ok" && (
              <div className="mt-0.5 break-words text-xs leading-5 text-zinc-600">
                {entry.detail}
              </div>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
