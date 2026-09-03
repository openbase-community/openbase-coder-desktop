import react from "@vitejs/plugin-react-swc";
import path from "path";
import { defineConfig } from "vite";

const sharedSrc = path.resolve(
  __dirname,
  "../coder-react/src"
);
const multiReactSrc = path.resolve(__dirname, "../multi-react/src");
const boilersyncReactSrc = path.resolve(__dirname, "../boilersync-react/src");
const multiReactEntry = path.resolve(multiReactSrc, "index.ts");
const boilersyncReactEntry = path.resolve(boilersyncReactSrc, "index.ts");
const desktopNodeModules = path.resolve(__dirname, "./node_modules");

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8081,
    fs: {
      allow: [
        __dirname,
        sharedSrc,
        multiReactSrc,
        boilersyncReactSrc,
        desktopNodeModules,
      ],
    },
  },
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": sharedSrc,
      "@openbase/coder-react": sharedSrc,
      "boilersync-react": boilersyncReactEntry,
      "multi-react": multiReactEntry,
      "@radix-ui/react-slot": path.resolve(
        desktopNodeModules,
        "@radix-ui/react-slot"
      ),
      "use-sync-external-store": path.resolve(
        desktopNodeModules,
        "use-sync-external-store"
      ),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "@radix-ui/react-slot",
      "use-sync-external-store",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "use-sync-external-store/shim",
      "use-sync-external-store/shim/with-selector",
      "style-to-js",
      "style-to-object",
      "inline-style-parser",
      "multi-react",
      "diff2html",
      "@profoundlogic/hogan",
    ],
  },
}));
