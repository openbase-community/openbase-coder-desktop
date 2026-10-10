import preset from "@openbase/coder-react/tailwind-preset";
import type { Config } from "tailwindcss";

export default {
  presets: [preset],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "../coder-react/src/**/*.{ts,tsx}",
    "../multi-react/src/**/*.{ts,tsx}",
    "../boilersync-react/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      // Onboarding loops are bounded (a finite iteration count) so a page
      // left waiting stops repainting; see src/onboarding/motion.tsx.
      keyframes: {
        "onboarding-pulse": {
          "0%, 100%": { opacity: "0.35", transform: "scale(0.9)" },
          "50%": { opacity: "0.12", transform: "scale(1.35)" },
        },
        "onboarding-breathe": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.03)" },
        },
      },
      animation: {
        "onboarding-pulse": "onboarding-pulse 2.8s ease-in-out 20",
        "onboarding-breathe": "onboarding-breathe 5.6s ease-in-out 3",
      },
    },
  },
} satisfies Config;
