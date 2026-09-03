import { motion } from "framer-motion";
import type { ReactNode } from "react";

import { calmSpring } from "../motion";

export function SecondaryButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#18498B]/10 bg-white/80 px-5 text-sm font-medium text-[#17365f] shadow-sm shadow-[#18498B]/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      transition={calmSpring}
      type="button"
      whileHover={disabled ? undefined : { y: -1, backgroundColor: "#f4f8ff" }}
      whileTap={disabled ? undefined : { scale: 0.985 }}
    >
      {children}
    </motion.button>
  );
}
