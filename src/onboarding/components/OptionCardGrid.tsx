import { CheckCircle2 } from "lucide-react";

import type { SelectableOption } from "../types";

export function OptionCardGrid<Id extends string>({
  disabled,
  onSelect,
  options,
  selected,
}: {
  disabled?: boolean;
  onSelect: (id: Id) => void;
  options: SelectableOption<Id>[];
  selected: Id;
}) {
  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-3">
      {options.map((option) => {
        const isSelected = selected === option.id;
        const isDisabled = Boolean(disabled || option.disabledReason);
        return (
          <button
            aria-pressed={isSelected}
            aria-disabled={isDisabled}
            className={`min-h-36 rounded-xl border px-4 py-4 text-left transition ${
              isSelected
                ? "border-[#18498B] bg-[#18498B]/[0.06] shadow-sm"
                : isDisabled
                  ? "border-slate-200 bg-slate-100 opacity-60"
                  : "border-[#18498B]/10 bg-[#f7faff] hover:bg-white"
            }`}
            disabled={isDisabled}
            key={option.id}
            onClick={() => {
              if (!isDisabled) {
                onSelect(option.id);
              }
            }}
            type="button"
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  isSelected ? "border-[#18498B] bg-[#18498B]" : "border-slate-300 bg-white"
                }`}
              >
                {isSelected && <CheckCircle2 aria-hidden className="h-3.5 w-3.5 text-white" />}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#0E0A07]">{option.label}</div>
                <div className="mt-1 text-xs font-medium text-slate-600">{option.summary}</div>
                <div className="mt-3 text-xs leading-5 text-slate-600">{option.description}</div>
                {option.disabledReason && (
                  <div className="mt-3 inline-flex rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-600">
                    {option.disabledReason}
                  </div>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
