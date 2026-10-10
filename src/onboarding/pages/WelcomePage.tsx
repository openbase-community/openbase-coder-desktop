import { ArrowRight } from "lucide-react";

import { PrimaryButton } from "../components/PrimaryButton";
import { BreathingLogo, FadeUp } from "../motion";

export function WelcomePage({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="flex min-h-[520px] flex-col items-center justify-center rounded-[22px] border border-white/80 bg-white/80 px-8 py-16 shadow-[0_28px_80px_-54px_rgba(24,73,139,.55),inset_0_1px_0_rgba(255,255,255,.9)] backdrop-blur-xl">
      <BreathingLogo size={72} />
      <FadeUp delay={0.25}>
        <h2 className="mt-8 text-center text-3xl font-semibold tracking-[-0.04em] text-[#0E0A07]">
          Welcome to Openbase
        </h2>
      </FadeUp>
      <FadeUp delay={0.35}>
        <p className="mt-3 max-w-md text-center text-sm leading-6 text-slate-500">
          Let&apos;s set up voice coding on this Mac and link your phone —
          with Openbase Cloud agents or your own Codex or Claude Code CLI.
        </p>
      </FadeUp>
      <FadeUp delay={0.45}>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <PrimaryButton onClick={onContinue}>
            Let's get you set up
            <ArrowRight aria-hidden className="h-4 w-4" />
          </PrimaryButton>
        </div>
      </FadeUp>
    </section>
  );
}
