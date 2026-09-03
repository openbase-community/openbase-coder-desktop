import { RefreshCw, X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import { calmSpring } from "./onboarding/motion";
import type { AppUpdateState } from "./onboarding/types";

/**
 * Unobtrusive corner notice shown once electron-updater has downloaded a new
 * desktop app version in the background; restarting installs it. Also shows a
 * dismissible failure notice when an update was found but could not be
 * downloaded (background "no update" checks never show anything).
 */
export function AppUpdateNotice() {
  const appUpdates = window.__OPENBASE_APP_UPDATES__;
  const [state, setState] = useState<AppUpdateState | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!appUpdates) {
      return undefined;
    }
    // The download may have finished before this renderer mounted.
    void appUpdates
      .status()
      .then((result) => {
        if (result.ok && result.state) {
          setState(result.state);
        }
        if (result.appVersion) {
          setCurrentVersion(result.appVersion);
        }
      })
      .catch((error) => {
        console.error("[app-updates] status check failed", error);
      });
    return appUpdates.onEvent(setState);
  }, [appUpdates]);

  // Only failures of an update that was actually found (version known) are
  // user-relevant; routine check failures stay in the main-process log.
  const downloadFailed = state?.status === "error" && Boolean(state.version);

  if (!appUpdates || dismissed || (state?.status !== "downloaded" && !downloadFailed)) {
    return null;
  }

  if (downloadFailed) {
    return (
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="fixed bottom-5 right-5 z-50 flex max-w-md items-start gap-3 rounded-2xl border border-red-200 bg-red-50 py-2.5 pl-4 pr-2.5 text-xs text-red-900 shadow-lg shadow-red-900/10"
        initial={{ opacity: 0, y: 12 }}
        transition={calmSpring}
      >
        <div className="min-w-0">
          <span className="font-medium">Update failed</span>
          {state?.version ? ` — Openbase ${state.version}` : ""}
          <p className="mt-0.5 break-words text-red-800">
            {state?.error ?? "The update could not be downloaded."}
          </p>
        </div>
        <button
          aria-label="Dismiss update error notice"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-red-400 hover:bg-red-100 hover:text-red-600"
          onClick={() => setDismissed(true)}
          type="button"
        >
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white py-2.5 pl-4 pr-2.5 text-xs text-zinc-500 shadow-lg shadow-zinc-900/10"
      initial={{ opacity: 0, y: 12 }}
      transition={calmSpring}
    >
      <div>
        <span className="font-medium text-zinc-900">Update ready</span>
        {state?.version ? ` — Openbase ${state.version}` : ""}
        {currentVersion ? ` (current v${currentVersion})` : ""}
      </div>
      <motion.button
        className="inline-flex h-8 items-center gap-2 rounded-full bg-zinc-900 px-3.5 font-medium text-white shadow-md shadow-zinc-900/10 disabled:opacity-40"
        disabled={restarting}
        onClick={() => {
          setRestarting(true);
          void appUpdates.quitAndInstall();
        }}
        transition={calmSpring}
        type="button"
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.97 }}
      >
        <RefreshCw aria-hidden className="h-3.5 w-3.5" />
        {restarting ? "Restarting…" : "Restart to update"}
      </motion.button>
      <button
        aria-label="Dismiss update notice"
        className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
        onClick={() => setDismissed(true)}
        type="button"
      >
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}
