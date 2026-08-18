import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the development runtime disables Miniflare's unusable console.createTask stub before React loads", async () => {
  const [entry, compatibility, vite] = await Promise.all([
    readFile("worker/index.ts", "utf8"),
    readFile("worker/console-task-compat.ts", "utf8"),
    readFile("vite.config.ts", "utf8"),
  ]);

  assert.match(entry, /import "\.\/console-task-compat";\s*import \{ handleImageOptimization/u);
  assert.match(compatibility, /taskConsole\.createTask\("KAI Cloud compatibility probe"\)/u);
  assert.match(compatibility, /typeof probe\.run !== "function"/u);
  assert.match(compatibility, /Object\.defineProperty\(taskConsole, "createTask", \{ configurable: true, value: undefined, writable: true \}\)/u);
  assert.doesNotMatch(compatibility, /NODE_ENV|process\.env/u);
  assert.match(vite, /define: \{ "console\.createTask": "undefined" \}/u);
});
