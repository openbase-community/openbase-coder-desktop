import type { ReactNode } from "react";

import { FadeUp } from "../motion";

export function PageShell({
  children,
  eyebrow,
  heading,
  support,
}: {
  children: ReactNode;
  eyebrow: string;
  heading: string;
  support: string;
}) {
  return (
    <section className="min-h-[520px] rounded-[22px] border border-white/80 bg-white/80 p-8 shadow-[0_28px_80px_-54px_rgba(24,73,139,.55),inset_0_1px_0_rgba(255,255,255,.9)] backdrop-blur-xl">
      <div className="max-w-2xl">
        <FadeUp>
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#18498B]/70">
            {eyebrow}
          </p>
        </FadeUp>
        <FadeUp delay={0.06}>
          <h2 className="mt-2.5 text-[28px] font-semibold tracking-[-0.035em] text-[#0E0A07]">
            {heading}
          </h2>
        </FadeUp>
        <FadeUp delay={0.12}>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">{support}</p>
        </FadeUp>
      </div>
      <FadeUp className="mt-8" delay={0.18}>
        {children}
      </FadeUp>
    </section>
  );
}
