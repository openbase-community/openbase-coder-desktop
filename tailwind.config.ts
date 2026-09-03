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
} satisfies Config;
