#!/usr/bin/env node

import { dirname } from "node:path";
import { AGENT_VERSION, checkConnection, heartbeat, pairDevice, processOneCommand, resumePairing } from "./client.mjs";
import { runDoctor } from "./doctor.mjs";
import { AgentError } from "./protocol.mjs";
import { readPairingFile, readState, stateFilePath } from "./state.mjs";

function log(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields })}\n`);
}

function fail(error) {
  const code = error instanceof AgentError ? error.code : "AGENT_FAILED";
  const message = error instanceof Error ? error.message : "Host Agent failed.";
  process.stderr.write(`${JSON.stringify({ timestamp: new Date().toISOString(), event: "agent.error", code, message })}\n`);
  process.exitCode = 1;
}

function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith("--")) throw new AgentError("ARGUMENT_INVALID", `Unexpected argument: ${item}`);
    const name = item.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new AgentError("ARGUMENT_INVALID", `Missing value for --${name}`);
    result[name] = value;
    index += 1;
  }
  return result;
}

async function stdinJson() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 16 * 1024) throw new AgentError("PAIRING_TOO_LARGE", "Pairing bundle exceeds 16 KiB.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AgentError("PAIRING_INVALID", "Pairing bundle is not valid JSON."); }
}

async function runService() {
  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  log("agent.started", { version: AGENT_VERSION });
  while (!stopping) {
    try {
      const result = await heartbeat();
      log("heartbeat.accepted", { deviceId: result.state.deviceId, sequence: result.state.lastSequence, capacityState: result.capacityState });
    } catch (error) {
      const code = error instanceof AgentError ? error.code : "HEARTBEAT_FAILED";
      log("heartbeat.failed", { code });
    }
    try {
      const processed = await processOneCommand();
      if (processed) log("command.completed", { commandId: processed.command.id, type: processed.command.type, outcome: processed.result.outcome });
    } catch (error) {
      const code = error instanceof AgentError ? error.code : "COMMAND_FAILED";
      log("command.failed", { code });
    }
    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  log("agent.stopped");
}

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "--version" || command === "version") {
    process.stdout.write(`${AGENT_VERSION}\n`);
    return;
  }
  if (command === "pair") {
    const input = options(args);
    const bundle = input["pairing-file"] ? await readPairingFile(input["pairing-file"]) : await stdinJson();
    const result = await pairDevice({
      bundle,
      displayName: input["display-name"],
      publicHost: input["public-host"],
      sshPortStart: input["ssh-port-start"],
      sshPortEnd: input["ssh-port-end"],
      gpuUuid: input["gpu-uuid"],
    });
    log("pairing.completed", { deviceId: result.deviceId, gpuModel: result.inventory.gpuModel });
    return;
  }
  if (command === "resume-pair") {
    const result = await resumePairing();
    log("pairing.completed", { deviceId: result.deviceId });
    return;
  }
  if (command === "check-connection") {
    const result = await checkConnection();
    log("connection.verified", { deviceId: result.state.deviceId, sequence: result.state.lastSequence, capacityState: result.capacityState });
    return;
  }
  if (command === "doctor") {
    const input = options(args);
    const result = await runDoctor({
      publicHost: input["public-host"],
      sshPortStart: input["ssh-port-start"],
      sshPortEnd: input["ssh-port-end"],
      gpuUuid: input["gpu-uuid"],
      storagePath: dirname(stateFilePath()),
    });
    log("doctor.passed", {
      gpuModel: result.inventory.gpuModel,
      gpuMemoryMiB: result.inventory.gpuMemoryMiB,
      driverVersion: result.inventory.driverVersion,
      cudaVersion: result.inventory.cudaVersion,
      dockerVersion: result.runtime.dockerVersion,
      nvidiaRuntime: result.runtime.nvidiaRuntime,
      managedPort: result.managedPort,
      storageReady: result.storageReady,
      memoryReady: result.memoryReady,
    });
    return;
  }
  if (command === "run") {
    await runService();
    return;
  }
  if (command === "show-state") {
    const state = await readState();
    log("state.summary", { status: state.status, deviceId: state.deviceId ?? null, lastSequence: state.lastSequence ?? 0, pairedAt: state.pairedAt ?? null });
    return;
  }
  process.stdout.write("KAI Host Agent\n\nCommands: pair, resume-pair, check-connection, doctor, run, show-state, version\n");
}

main().catch(fail);
