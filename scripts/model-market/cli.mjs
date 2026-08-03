#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { promoteModelMarket, stageModelMarket } from "./pipeline.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pendingPath = process.env.KAI_MARKET_PENDING_PATH
  ? resolve(process.env.KAI_MARKET_PENDING_PATH)
  : resolve(projectRoot, ".market-cache/model-market.pending.json");
const snapshotPath = process.env.KAI_MARKET_SNAPSHOT_PATH
  ? resolve(process.env.KAI_MARKET_SNAPSHOT_PATH)
  : resolve(projectRoot, "data/model-market.snapshot.json");

export async function runCli(command, dependencies = {}) {
  if (command === "update") {
    const staged = await runCli("stage", dependencies);
    const promoted = await runCli("promote", dependencies);
    return {
      command,
      generatedAt: staged.generatedAt,
      publishedAt: promoted.publishedAt,
      quoteCount: promoted.quoteCount,
      index: promoted.index,
    };
  }
  if (command === "stage") {
    const registryModule = dependencies.registryModule
      ?? await import(pathToFileURL(resolve(projectRoot, "data/model-market-registry.mjs")).href);
    const result = await stageModelMarket({
      modelRegistry: registryModule.modelRegistry,
      usdCnyFallback: registryModule.USD_CNY_FALLBACK,
      pendingPath,
      snapshotPath,
      ...dependencies,
    });
    return { command, generatedAt: result.generatedAt, quoteCount: result.quotes.length };
  }
  if (command === "promote") {
    const registryModule = dependencies.registryModule
      ?? await import(pathToFileURL(resolve(projectRoot, "data/model-market-registry.mjs")).href);
    const expectedRegistryIds = registryModule.modelRegistry.map((entry) => entry.id);
    const result = await promoteModelMarket({
      pendingPath,
      snapshotPath,
      expectedRegistryIds,
      ...dependencies,
    });
    return { command, publishedAt: result.publishedAt, quoteCount: result.quotes.length, index: result.index.current };
  }
  throw new Error("Usage: node scripts/model-market/cli.mjs <stage|promote|update>");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv[2])
    .then((summary) => process.stdout.write(`${JSON.stringify(summary)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.code ?? "MODEL_MARKET_ERROR"}: ${error.message}\n`);
      process.exitCode = 1;
    });
}
