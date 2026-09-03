import { motion } from "framer-motion";
import type { ReactNode } from "react";

import { calmSpring } from "../motion";

export function PrimaryButton({
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
      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#18498B] px-5 text-sm font-medium text-white shadow-lg shadow-[#18498B]/20 disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      transition={calmSpring}
      type="button"
      whileHover={disabled ? undefined : { y: -1, backgroundColor: "#153f78" }}
      whileTap={disabled ? undefined : { scale: 0.985 }}
    >
      {children}
    </motion.button>
  );
}
