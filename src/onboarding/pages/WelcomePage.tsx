import { ArrowRight, Circle } from "lucide-react";

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
          Let&apos;s set up voice coding on this Mac and link your iPhone —
          with managed Openbase Cloud agents or your own Codex or Claude Code
          CLI. Take your time — each step waits for you.
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
      <FadeUp delay={0.55}>
        <div className="mt-10 flex max-w-lg flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {["Install the CLI", "Choose your coding agent", "Run setup", "Sign in to Openbase", "Link your iPhone", "Pair privately"].map(
            (item) => (
              <div className="flex items-center gap-2 text-xs text-zinc-400" key={item}>
                <Circle aria-hidden className="h-1.5 w-1.5 fill-zinc-300 text-zinc-300" />
                {item}
              </div>
            ),
          )}
        </div>
      </FadeUp>
    </section>
  );
}
