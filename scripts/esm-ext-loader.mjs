// Test-only helper: this codebase's own source files use Vite-style
// extension-less relative imports (e.g. "./followUps", no ".js"), which
// Vite resolves at dev/build time but plain `node` does not. This loader
// hook lets ad-hoc test scripts run those same source files directly under
// `node`, without touching any shipped source file. Registered via
// `node --import ./scripts/esm-ext-loader.mjs <script>`.
import { register } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

register(import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    if (existsSync(base + ".js")) {
      return nextResolve(specifier + ".js", context);
    }
  }
  return nextResolve(specifier, context);
}
