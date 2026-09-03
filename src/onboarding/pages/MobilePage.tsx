import { ArrowRight, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { PageShell } from "../components/PageShell";
import { PrimaryButton } from "../components/PrimaryButton";
import { StatusIcon } from "../components/StatusIcon";
import { MOBILE_APP_DOWNLOAD_URL } from "../config";
import { PulsingDot } from "../motion";

export function MobilePage({
  cloudStateError,
  mobileAuthenticated,
  onContinue,
}: {
  cloudStateError: string | null;
  mobileAuthenticated: boolean;
  onContinue: () => void;
}) {
  return (
    <PageShell
      eyebrow="Step 7"
      heading="Get Openbase on your iPhone"
      support="Scan the QR code to download the Openbase iOS app, then sign in with the same account. This page updates automatically once your phone is linked."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="flex flex-col items-start gap-5 rounded-xl border border-zinc-200 bg-zinc-50 p-5 sm:flex-row">
            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <QRCodeSVG size={168} value={MOBILE_APP_DOWNLOAD_URL} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-950">
                <Smartphone aria-hidden className="h-4 w-4 text-zinc-500" />
                Scan to download Openbase on your iPhone
              </div>
              <div className="mt-2 text-sm leading-6 text-zinc-600">
                Open the Camera app and point it at the code, or visit the link
                below on your phone. Sign in with the same Openbase account you
                used here.
              </div>
              <div className="mt-3 break-all font-mono text-xs text-zinc-800">
                {MOBILE_APP_DOWNLOAD_URL}
              </div>
            </div>
          </div>

          {mobileAuthenticated ? (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Your phone is signed in. Continue to pairing.
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-600">
              <PulsingDot />
              Waiting for your phone to sign in
            </div>
          )}
          {cloudStateError && !mobileAuthenticated && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {cloudStateError}
            </div>
          )}
        </div>

        <aside className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="text-sm font-medium text-zinc-950">Phone link state</div>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Phone signed in</dt>
              <dd className="mt-1 inline-flex items-center gap-1.5 text-zinc-800">
                <StatusIcon ok={mobileAuthenticated} />
                {mobileAuthenticated ? "Linked" : "Not yet"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Checks</dt>
              <dd className="mt-1 text-zinc-800">
                Updates every few seconds while this page is open.
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <PrimaryButton disabled={!mobileAuthenticated} onClick={onContinue}>
          Continue to pairing
          <ArrowRight aria-hidden className="h-4 w-4" />
        </PrimaryButton>
      </div>
    </PageShell>
  );
}
