import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";

import { SecondaryButton } from "./SecondaryButton";

export type SystemSettingsSlide = {
  alt: string;
  body: string;
  imageClassName?: string;
  src: string;
  title: string;
};

/**
 * Reusable visual guide for any onboarding step that sends someone into
 * macOS System Settings. Text directions alone are not sufficient for a
 * pane outside Openbase; every such step should supply one or more exact
 * screenshots through this component.
 */
export function SystemSettingsGuide({ slides }: { slides: SystemSettingsSlide[] }) {
  const [index, setIndex] = useState(0);
  if (slides.length === 0) return null;

  const slide = slides[Math.min(index, slides.length - 1)];
  const hasMultipleSlides = slides.length > 1;

  return (
    <section
      aria-label="System Settings instructions"
      className="mt-3 overflow-hidden rounded-xl border border-zinc-200 bg-white"
    >
      <div className="border-b border-zinc-200 px-3 py-2.5" aria-live="polite">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-zinc-900">{slide.title}</div>
            <p className="mt-1 text-xs leading-5 text-zinc-600">{slide.body}</p>
          </div>
          {hasMultipleSlides && (
            <span className="shrink-0 text-[11px] font-medium text-zinc-500">
              {index + 1} of {slides.length}
            </span>
          )}
        </div>
      </div>
      <div className="bg-zinc-100 p-2">
        <img
          alt={slide.alt}
          className={`h-56 w-full rounded-lg border border-zinc-200 object-cover ${slide.imageClassName ?? "object-center"}`}
          src={slide.src}
        />
      </div>
      {hasMultipleSlides && (
        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-3 py-2">
          <SecondaryButton
            disabled={index === 0}
            onClick={() => setIndex((current) => Math.max(0, current - 1))}
          >
            <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
            Previous
          </SecondaryButton>
          <div className="flex items-center gap-1.5" aria-hidden>
            {slides.map((item, slideIndex) => (
              <span
                className={`h-1.5 rounded-full transition-all ${
                  slideIndex === index ? "w-5 bg-[#18498B]" : "w-1.5 bg-zinc-300"
                }`}
                key={item.title}
              />
            ))}
          </div>
          <SecondaryButton
            disabled={index === slides.length - 1}
            onClick={() => setIndex((current) => Math.min(slides.length - 1, current + 1))}
          >
            Next
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </SecondaryButton>
        </div>
      )}
    </section>
  );
}
