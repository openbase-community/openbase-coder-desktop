import { X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import { calmSpring } from "./onboarding/motion";
import type { DesktopControlState } from "./onboarding/types";

/**
 * Corner notice shown when the Electron main process could not start its
 * localhost desktop control server. Without it, phone- and CLI-initiated
 * features (like remote screen sharing) silently do nothing, so the failure
 * is surfaced once here instead of living only in the main-process log.
 */
export function DesktopControlNotice() {
  const desktopControl = window.__OPENBASE_DESKTOP_CONTROL__;
  const [state, setState] = useState<DesktopControlState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!desktopControl) {
      return undefined;
    }
    // The failure may have happened before this renderer mounted.
    void desktopControl
      .status()
      .then((result) => {
        if (result.ok && result.state) {
          setState(result.state);
        }
      })
      .catch((error) => {
        console.error("[desktop-control] status check failed", error);
      });
    return desktopControl.onEvent(setState);
  }, [desktopControl]);

  if (!desktopControl || dismissed || state?.status !== "error") {
    return null;
  }

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="fixed bottom-5 left-5 z-50 flex max-w-md items-start gap-3 rounded-2xl border border-red-200 bg-red-50 py-2.5 pl-4 pr-2.5 text-xs text-red-900 shadow-lg shadow-red-900/10"
      initial={{ opacity: 0, y: 12 }}
      transition={calmSpring}
    >
      <div className="min-w-0">
        <span className="font-medium">Desktop control unavailable</span>
        <p className="mt-0.5 break-words text-red-800">
          {state.error ?? "The desktop control server failed to start."} Phone-initiated screen
          sharing will not work until you restart the app.
        </p>
      </div>
      <button
        aria-label="Dismiss desktop control notice"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-red-400 hover:bg-red-100 hover:text-red-600"
        onClick={() => setDismissed(true)}
        type="button"
      >
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}
