import { createConnection as createTcpConnection } from "node:net";
import { connect as createTlsConnection } from "node:tls";

function connectSocket(options) {
  return new Promise((resolve, reject) => {
    const socket = options.allowPlaintext
      ? createTcpConnection({ host: options.gatewayHost, port: options.gatewayPort })
      : createTlsConnection({ host: options.gatewayHost, port: options.gatewayPort, servername: options.serverName ?? options.gatewayHost, minVersion: "TLSv1.3", ca: options.ca });
    socket.once(options.allowPlaintext ? "connect" : "secureConnect", () => resolve(socket));
    socket.once("error", reject);
  });
}

export async function openGatewaySlot(options) {
  const gateway = await connectSocket(options);
  gateway.write(`${JSON.stringify({ version: 1, leaseId: options.leaseId, ticket: options.ticket })}\n`);
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let paired = false;
    const timer = setTimeout(() => fail(new Error("GATEWAY_HANDSHAKE_TIMEOUT")), options.handshakeTimeoutMs ?? 15_000);
    const fail = (error) => { clearTimeout(timer); gateway.destroy(); reject(error); };
    const closed = () => { if (!paired) fail(new Error("GATEWAY_HANDSHAKE_REJECTED")); };
    gateway.once("error", fail);
    gateway.once("close", closed);
    gateway.on("data", function control(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 4096) return fail(new Error("GATEWAY_CONTROL_INVALID"));
      while (true) {
        const newline = buffer.indexOf(10);
        if (newline < 0) return;
        const line = buffer.subarray(0, newline).toString("utf8").trim();
        buffer = buffer.subarray(newline + 1);
        if (line === "WAITING") { options.onWaiting?.(); continue; }
        if (line !== "CONNECT") return fail(new Error("GATEWAY_CONTROL_INVALID"));
        paired = true;
        clearTimeout(timer);
        gateway.pause();
        gateway.off("data", control);
        gateway.off("error", fail);
        gateway.off("close", closed);
        const target = createTcpConnection({ host: options.targetHost ?? "127.0.0.1", port: options.targetPort });
        target.once("connect", () => {
          if (buffer.length) target.write(buffer);
          gateway.pipe(target);
          target.pipe(gateway);
          gateway.resume();
          resolve({ gateway, target });
        });
        target.once("error", (error) => { gateway.destroy(); reject(error); });
        return;
      }
    });
  });
}

export async function runGatewayPool(options) {
  const concurrency = Number.isSafeInteger(options.concurrency) ? Math.max(1, Math.min(8, options.concurrency)) : 2;
  let stopped = false;
  const sockets = new Set();
  const workers = Array.from({ length: concurrency }, async () => {
    while (!stopped) {
      try {
        const pair = await openGatewaySlot(options);
        sockets.add(pair.gateway); sockets.add(pair.target);
        await new Promise((resolve) => pair.gateway.once("close", resolve));
        sockets.delete(pair.gateway); sockets.delete(pair.target);
      } catch (error) {
        if (!stopped) {
          options.onError?.(error);
          await new Promise((resolve) => setTimeout(resolve, options.retryMs ?? 2_000));
        }
      }
    }
  });
  return {
    async stop() {
      stopped = true;
      for (const socket of sockets) socket.destroy();
      await Promise.allSettled(workers);
    },
    workers,
  };
}
