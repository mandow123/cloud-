import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const candidate = fileURLToPath(new URL(`../${specifier.slice(2)}`, import.meta.url));
    for (const path of [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}/index.ts`, `${candidate}/index.tsx`]) {
      if (existsSync(path)) return { shortCircuit: true, url: pathToFileURL(path).href };
    }
    return nextResolve(specifier, context);
  },
});

// Legacy API regression fixtures predate formal accounts. Production and the
// local preview never set this test-only compatibility switch.
process.env.KAI_ALLOW_LEGACY_ANON_WRITES = "TEST_ONLY_UNSAFE";
process.env.KAI_HOSTING_APPROVED_IMAGES = `ghcr.io/kai-cloud/cuda-pytorch@sha256:${"a".repeat(64)}`;
process.env.KAI_HOSTING_TERMS_VERSION = "KAI_HOSTING_TERMS_2026_08";
