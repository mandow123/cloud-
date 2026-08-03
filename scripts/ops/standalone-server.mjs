#!/usr/bin/env node

import path, { join } from "node:path";

const originalRelative = path.relative;

// Vinext 0.0.50 builds static cache keys with path.relative(). On Windows that
// produces backslashes, while incoming URL paths use forward slashes. Normalize
// only during server startup, when the cache is created; Linux production is
// unaffected.
if (process.platform === "win32") {
  path.relative = (from, to) => originalRelative(from, to).replaceAll("\\", "/");
}

try {
  const { startProdServer } = await import("vinext/server/prod-server");
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.HOST ?? "0.0.0.0";

  await startProdServer({
    port,
    host,
    outDir: join(import.meta.dirname, "dist"),
  });
} catch (error) {
  console.error("[KAI Cloud] Failed to start standalone server");
  console.error(error);
  process.exitCode = 1;
} finally {
  path.relative = originalRelative;
}
