import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

rmSync(path.join(repoRoot, "release"), { force: true, recursive: true });
rmSync(path.join(repoRoot, "bundled", "OpenbaseCoderCLI"), { force: true, recursive: true });
