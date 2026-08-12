#!/usr/bin/env node

import { chmod, mkdir, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute } from "node:path";
import { enforceExpiredWorkloads, executeCleanup, executeDoctor, executeProvision, executeStart, executeStop } from "./actuator.mjs";
import { AgentError } from "./protocol.mjs";

const socketPath = process.env.KAI_HOST_ACTUATOR_SOCKET?.trim() || "/run/kai-host-actuator/actuator.sock";
if (!isAbsolute(socketPath) || !/^\/[A-Za-z0-9._/-]{3,200}\.sock$/u.test(socketPath) || socketPath.includes("..")) throw new Error("ACTUATOR_SOCKET_INVALID");

let queue = Promise.resolve();
const server = createServer({ allowHalfOpen: true }, (socket) => {
  const chunks = [];
  let length = 0;
  let rejected = false;
  socket.setTimeout(35_000, () => socket.destroy());
  socket.on("data", (chunk) => {
    length += chunk.length;
    if (length > 32 * 1024) {
      rejected = true;
      socket.destroy();
      return;
    }
    chunks.push(chunk);
  });
  socket.on("end", () => {
    if (rejected) return;
    queue = queue.then(async () => {
      try {
        const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const result = request?.operation === "DOCTOR"
          ? await executeDoctor(request)
          : request?.operation === "PROVISION"
            ? await executeProvision(request)
          : request?.operation === "START"
            ? await executeStart(request)
            : request?.operation === "STOP"
              ? await executeStop(request)
              : request?.operation === "CLEANUP"
                ? await executeCleanup(request)
                : (() => { throw new AgentError("ACTUATOR_OPERATION_UNSUPPORTED", "Actuator operation is unsupported."); })();
        socket.end(`${JSON.stringify({ ok: true, result })}\n`);
      } catch (error) {
        const code = error instanceof AgentError ? error.code : "ACTUATOR_FAILED";
        socket.end(`${JSON.stringify({ ok: false, error: { code } })}\n`);
      }
    });
  });
});

await mkdir(dirname(socketPath), { recursive: true, mode: 0o750 });
await unlink(socketPath).catch((error) => { if (error?.code !== "ENOENT") throw error; });
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(socketPath, resolve);
});
await chmod(socketPath, 0o660);
const runWatchdog = async () => {
  try { await enforceExpiredWorkloads(); }
  catch (error) {
    const code = error instanceof AgentError ? error.code : "WATCHDOG_FAILED";
    process.stderr.write(`${JSON.stringify({ timestamp: new Date().toISOString(), event: "actuator.watchdog_failed", code })}\n`);
  }
};
const watchdog = setInterval(() => {
  queue = queue.then(runWatchdog);
}, 5_000);
watchdog.unref();
queue = queue.then(runWatchdog);
process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), event: "actuator.started" })}\n`);

const shutdown = () => { clearInterval(watchdog); server.close(() => process.exit(0)); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
