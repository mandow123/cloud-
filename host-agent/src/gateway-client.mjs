import { readFile } from "node:fs/promises";
import { createConnection as createTcpConnection } from "node:net";
import { connect as createTlsConnection } from "node:tls";
import { AgentError } from "./protocol.mjs";

const HOST = /^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\[[0-9a-f:]+\])$/u;
const ID = /^[a-z][a-z0-9_]{5,95}$/u;
const TICKET = /^[A-Za-z0-9_-]{40,80}$/u;

export function validateGatewayBundle(value, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentError("GATEWAY_BUNDLE_INVALID", "Gateway bundle must be a JSON object.");
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "expiresAt,gatewayHost,gatewayPort,leaseId,serverName,targetPort,ticket,version" || value.version !== 1
    || typeof value.gatewayHost !== "string" || !HOST.test(value.gatewayHost.toLowerCase())
    || typeof value.serverName !== "string" || !HOST.test(value.serverName.toLowerCase())
    || !Number.isSafeInteger(value.gatewayPort) || value.gatewayPort < 1 || value.gatewayPort > 65535
    || typeof value.leaseId !== "string" || !ID.test(value.leaseId)
    || typeof value.ticket !== "string" || !TICKET.test(value.ticket)
    || !Number.isSafeInteger(value.targetPort) || value.targetPort < 1024 || value.targetPort > 65535
    || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))
    || Date.parse(value.expiresAt) <= now || Date.parse(value.expiresAt) > now + 32 * 24 * 60 * 60_000) {
    throw new AgentError("GATEWAY_BUNDLE_INVALID", "Gateway bundle fields are invalid or expired.");
  }
  return { ...value, gatewayHost: value.gatewayHost.toLowerCase(), serverName: value.serverName.toLowerCase() };
}

export async function readGatewayBundle(path) {
  if (typeof path !== "string" || !/^\/[A-Za-z0-9._/-]{3,240}$/u.test(path) || path.includes("..")) throw new AgentError("GATEWAY_BUNDLE_PATH_INVALID", "Gateway bundle path must be absolute and normalized.");
  let content;
  try { content = await readFile(path, { encoding: "utf8" }); }
  catch (error) { throw new AgentError("GATEWAY_BUNDLE_UNREADABLE", "Gateway bundle could not be read.", { cause: error }); }
  if (Buffer.byteLength(content) > 16 * 1024) throw new AgentError("GATEWAY_BUNDLE_INVALID", "Gateway bundle is too large.");
  try { return validateGatewayBundle(JSON.parse(content)); }
  catch (error) { throw error instanceof AgentError ? error : new AgentError("GATEWAY_BUNDLE_INVALID", "Gateway bundle is not valid JSON.", { cause: error }); }
}

function connectGateway(options) {
  return new Promise((resolve, reject) => {
    const socket = options.allowPlaintextLocal
      ? createTcpConnection({ host: options.gatewayHost, port: options.gatewayPort })
      : createTlsConnection({ host: options.gatewayHost, port: options.gatewayPort, servername: options.serverName, minVersion: "TLSv1.3" });
    socket.once(options.allowPlaintextLocal ? "connect" : "secureConnect", () => resolve(socket));
    socket.once("error", reject);
  });
}

export async function openGatewaySlot(input) {
  const options = validateGatewayBundle({
    version: input.version,
    gatewayHost: input.gatewayHost,
    gatewayPort: input.gatewayPort,
    serverName: input.serverName,
    leaseId: input.leaseId,
    ticket: input.ticket,
    targetPort: input.targetPort,
    expiresAt: input.expiresAt,
  });
  const gateway = await connectGateway({ ...options, allowPlaintextLocal: input.allowPlaintextLocal === true });
  gateway.write(`${JSON.stringify({ version: 1, leaseId: options.leaseId, ticket: options.ticket })}\n`);
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let paired = false;
    const timer = setTimeout(() => fail(new AgentError("GATEWAY_HANDSHAKE_TIMEOUT", "Gateway did not accept the Agent slot in time.")), input.handshakeTimeoutMs ?? 15_000);
    const fail = (error) => { clearTimeout(timer); gateway.destroy(); reject(error); };
    const closed = () => { if (!paired) fail(new AgentError("GATEWAY_HANDSHAKE_REJECTED", "Gateway rejected the Agent ticket.")); };
    gateway.once("error", fail);
    gateway.once("close", closed);
    gateway.on("data", function control(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 4096) return fail(new AgentError("GATEWAY_CONTROL_INVALID", "Gateway control response is invalid."));
      while (true) {
        const newline = buffer.indexOf(10);
        if (newline < 0) return;
        const line = buffer.subarray(0, newline).toString("utf8").trim();
        buffer = buffer.subarray(newline + 1);
        if (line === "WAITING") { input.onWaiting?.(); continue; }
        if (line !== "CONNECT") return fail(new AgentError("GATEWAY_CONTROL_INVALID", "Gateway control response is invalid."));
        paired = true;
        clearTimeout(timer);
        gateway.pause();
        gateway.off("data", control);
        gateway.off("error", fail);
        gateway.off("close", closed);
        const target = createTcpConnection({ host: "127.0.0.1", port: options.targetPort });
        target.once("connect", () => {
          if (buffer.length) target.write(buffer);
          gateway.pipe(target); target.pipe(gateway); gateway.resume();
          resolve({ gateway, target });
        });
        target.once("error", (error) => fail(new AgentError("GATEWAY_TARGET_UNREACHABLE", "Order container SSH is not reachable on loopback.", { cause: error })));
        return;
      }
    });
  });
}

export async function runGatewayPool(bundle, controls = {}) {
  const options = validateGatewayBundle(bundle);
  const concurrency = Number.isSafeInteger(controls.concurrency) ? Math.max(1, Math.min(8, controls.concurrency)) : 2;
  let stopped = false;
  const sockets = new Set();
  const workers = Array.from({ length: concurrency }, async () => {
    while (!stopped && Date.parse(options.expiresAt) > Date.now()) {
      try {
        const pair = await openGatewaySlot({ ...options, allowPlaintextLocal: controls.allowPlaintextLocal, onWaiting: controls.onWaiting });
        sockets.add(pair.gateway); sockets.add(pair.target);
        await new Promise((resolve) => pair.gateway.once("close", resolve));
        sockets.delete(pair.gateway); sockets.delete(pair.target);
      } catch (error) {
        if (!stopped) {
          controls.onError?.(error);
          await new Promise((resolve) => setTimeout(resolve, controls.retryMs ?? 2_000));
        }
      }
    }
  });
  return {
    workers,
    async stop() {
      stopped = true;
      for (const socket of sockets) socket.destroy();
      await Promise.allSettled(workers);
    },
  };
}
