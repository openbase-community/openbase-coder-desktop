import { motion, type Transition, type Variants } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Calm motion language for the onboarding shell: slow springs, breathing
 * pulses, and staggered fade-up entrances. Durations sit in the 300–700 ms
 * range with gentle damping — grounding, never flashy.
 */
export const calmSpring: Transition = {
  type: "spring",
  stiffness: 170,
  damping: 26,
  mass: 1,
};

export const calmEase: Transition = {
  duration: 0.45,
  ease: [0.4, 0, 0.2, 1],
};

export const fadeUpVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: calmSpring },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09 } },
};

/** Page-to-page transition: continuous fade with a slight drift. */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { ...calmEase, duration: 0.5 } },
  exit: { opacity: 0, y: -8, transition: { ...calmEase, duration: 0.3 } },
};

export function FadeUp({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={className}
      initial={{ opacity: 0, y: 14 }}
      transition={{ ...calmSpring, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A quiet pulsing dot shown while waiting on a remote state change —
 * calmer than a spinner, reads as "breathing" rather than "working".
 */
export function PulsingDot({ className = "" }: { className?: string }) {
  return (
    <span className={`relative inline-flex h-4 w-4 items-center justify-center ${className}`}>
      <motion.span
        animate={{ opacity: [0.35, 0.12, 0.35], scale: [0.9, 1.35, 0.9] }}
        className="absolute inline-flex h-4 w-4 rounded-full bg-emerald-500"
        transition={{ duration: 2.8, ease: "easeInOut", repeat: Infinity }}
      />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  );
}

/** The Openbase pinwheel mark, inheriting `currentColor`. */
export function OpenbaseMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg aria-hidden className={className} fill="none" viewBox="0 0 32 32">
      <path d="M0 7C0 3.13401 3.13401 0 7 0H16V16H0V7Z" fill="currentColor" />
      <path d="M16 16H32V25C32 28.866 28.866 32 25 32H16V16Z" fill="currentColor" />
      <path d="M20 0H32V12L16 16L20 0Z" fill="currentColor" />
      <path d="M0 20L16 16L12 32H0V20Z" fill="currentColor" />
    </svg>
  );
}

/** Logo tile with a slow breathing scale, for welcome moments. */
export function BreathingLogo({ size = 64 }: { size?: number }) {
  return (
    <motion.div
      animate={{ opacity: 1, scale: [1, 1.03, 1] }}
      className="flex items-center justify-center rounded-2xl bg-[#18498B] text-white shadow-lg shadow-[#18498B]/20"
      initial={{ opacity: 0, scale: 0.92 }}
      style={{ height: size, width: size }}
      transition={{
        opacity: { ...calmEase, duration: 0.7 },
        scale: { duration: 5.6, ease: "easeInOut", repeat: Infinity },
      }}
    >
      <OpenbaseMark className="h-1/2 w-1/2" />
    </motion.div>
  );
}
