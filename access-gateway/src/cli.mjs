#!/usr/bin/env node
import { KaiAccessGateway } from "./gateway.mjs";
import { gatewayOptionsFromEnvironment } from "./config.mjs";

const gateway = new KaiAccessGateway({
  ...gatewayOptionsFromEnvironment(),
  logger: (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
});

await gateway.start();
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await gateway.stop(); process.exitCode = 0; }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ level: "error", event: "gateway.shutdown_failed", errorCode: error?.code ?? "UNKNOWN" })}\n`);
    process.exitCode = 1;
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
