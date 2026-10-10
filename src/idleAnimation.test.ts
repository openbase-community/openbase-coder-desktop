import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Tripwire: an idle desktop window burned ~105% CPU (WindowServer + GPU
// helper) repainting endless loops. Looping animations must be finite or
// tied to real pending work, never `repeat: Infinity` on a static page.
const srcDir = __dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("idle animation budget", () => {
  it("has no infinite framer-motion loops", () => {
    const offenders = sourceFiles(srcDir).filter((file) =>
      /repeat:\s*Infinity/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("gives every custom tailwind animation a finite iteration count", () => {
    const config = readFileSync(path.resolve(srcDir, "..", "tailwind.config.ts"), "utf8");
    const animationBlock = config.slice(config.indexOf("animation: {"));
    const values = [...animationBlock.matchAll(/"[\w-]+":\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).not.toMatch(/\binfinite\b/);
      expect(value).toMatch(/\s\d+$/);
    }
  });
});
