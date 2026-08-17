import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { KaiAccessGateway } from "../access-gateway/src/gateway.mjs";
import { openGatewaySlot } from "../access-gateway/src/agent-client.mjs";

const HELPER = resolve("public/kai-cloud-ssh-proxy.mjs");
const CONTROL_TOKEN = "buyer-helper-control-token-that-is-long-enough";
const TICKET_PEPPER = "buyer-helper-ticket-pepper-that-is-long-enough";

function listen(server) {
  return new Promise((resolveAddress, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveAddress(server.address()));
  });
}

function tokenFile(token) {
  const directory = mkdtempSync(join(tmpdir(), "kai-cloud-access-"));
  chmodSync(directory, 0o700);
  const path = join(directory, "token");
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  return { directory, path };
}

function run(command, args, input = "", options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let completedBytes = 0;
    const timeout = options.endAfterOutputBytes ? setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Proxy helper did not return ${options.endAfterOutputBytes} bytes before timeout`));
    }, 5_000) : null;
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      completedBytes += chunk.length;
      if (options.endAfterOutputBytes && completedBytes >= options.endAfterOutputBytes && !child.stdin.destroyed) child.stdin.end();
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (timeout) clearTimeout(timeout);
      resolveRun({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), spawnargs: child.spawnargs });
    });
    if (options.endAfterOutputBytes) child.stdin.write(input);
    else child.stdin.end(input);
  });
}

async function gatewayFixture() {
  const gateway = new KaiAccessGateway({
    dbPath: ":memory:", controlToken: CONTROL_TOKEN, ticketPepper: TICKET_PEPPER,
    publicHost: "127.0.0.1", controlHost: "127.0.0.1", controlPort: 0,
    tunnelHost: "127.0.0.1", tunnelPort: 0, buyerHost: "127.0.0.1",
    publicPortStart: 0, publicPortEnd: 0, allowPlaintextTunnel: true,
    buyerHandshakeTimeoutMs: 500,
  });
  await gateway.start();
  return gateway;
}

function helperArgs(access, file, expiresAt = access.expiresAt) {
  return [HELPER, "--endpoint", access.buyerEndpoint, "--lease-id", access.leaseId, "--expires-at", expiresAt, "--token-file", file];
}

test("buyer helper carries SSH bytes through the Gateway and erases its 0600 token file", async () => {
  const echo = createServer((socket) => socket.pipe(socket));
  const echoAddress = await listen(echo);
  const gateway = await gatewayFixture();
  const access = await gateway.createLease({ leaseId: "hgw_helpergolden", deviceId: "had_helpergolden", contractId: "hctr_helpergolden", expiresAt: new Date(Date.now() + 300_000).toISOString() });
  let markWaiting;
  const waiting = new Promise((resolveWaiting) => { markWaiting = resolveWaiting; });
  const slot = openGatewaySlot({
    allowPlaintext: true, gatewayHost: "127.0.0.1", gatewayPort: access.agentTunnel.port,
    leaseId: access.leaseId, ticket: access.agentTunnel.ticket, targetHost: "127.0.0.1", targetPort: echoAddress.port,
    onWaiting: markWaiting,
  });
  const secret = access.buyerAccess.token;
  const token = tokenFile(secret);
  try {
    await waiting;
    const payload = "SSH-2.0-KAI-HELPER\r\n";
    const result = await run(process.execPath, helperArgs(access, token.path), payload, { endAfterOutputBytes: Buffer.byteLength(payload) });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.toString(), "SSH-2.0-KAI-HELPER\r\n");
    assert.equal(result.stderr.toString().includes(secret), false);
    assert.equal(result.spawnargs.join(" ").includes(secret), false);
    assert.throws(() => readFileSync(token.path), /ENOENT/u);
    const pair = await slot;
    pair.gateway.destroy(); pair.target.destroy();
  } finally {
    rmSync(token.directory, { recursive: true, force: true });
    await gateway.stop(); echo.close();
  }
});

test("system OpenSSH uses the buyer ProxyCommand to reach the Host Agent target", async (t) => {
  const sshVersion = [];
  const targetReached = new Promise((resolveReached) => {
    const server = createServer((socket) => {
      socket.write("SSH-2.0-KAI_Test_Server\r\n");
      socket.once("data", (chunk) => {
        sshVersion.push(chunk);
        resolveReached();
        setTimeout(() => socket.destroy(), 25);
      });
    });
    t.after(() => server.close());
    void listen(server).then((address) => { targetReached.address = address; });
  });
  while (!targetReached.address) await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  const gateway = await gatewayFixture();
  t.after(() => gateway.stop());
  const access = await gateway.createLease({ leaseId: "hgw_realopenssh", deviceId: "had_realopenssh", contractId: "hctr_realopenssh", expiresAt: new Date(Date.now() + 300_000).toISOString() });
  let markWaiting;
  const waiting = new Promise((resolveWaiting) => { markWaiting = resolveWaiting; });
  const slot = openGatewaySlot({
    allowPlaintext: true, gatewayHost: "127.0.0.1", gatewayPort: access.agentTunnel.port,
    leaseId: access.leaseId, ticket: access.agentTunnel.ticket, targetHost: "127.0.0.1", targetPort: targetReached.address.port,
    onWaiting: markWaiting,
  });
  const secret = access.buyerAccess.token;
  const token = tokenFile(secret);
  t.after(() => rmSync(token.directory, { recursive: true, force: true }));
  await waiting;
  const proxy = [process.execPath, ...helperArgs(access, token.path)].join(" ");
  const ssh = run("/usr/bin/ssh", [
    "-F", "/dev/null", "-o", "BatchMode=yes", "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", `ProxyCommand=${proxy}`, `kai@${access.leaseId}.kai`,
  ]);
  await Promise.race([targetReached, new Promise((_, reject) => setTimeout(() => reject(new Error("OpenSSH did not reach target")), 5_000))]);
  const result = await ssh;
  assert.match(Buffer.concat(sshVersion).toString(), /^SSH-2\.0-OpenSSH_/u);
  assert.equal(result.spawnargs.join(" ").includes(secret), false);
  assert.equal(result.stderr.toString().includes(secret), false);
  assert.throws(() => readFileSync(token.path), /ENOENT/u);
  const pair = await slot;
  pair.gateway.destroy(); pair.target.destroy();
});

test("expired, replayed, rotated and revoked buyer credentials fail closed without exposing tokens", async () => {
  const gateway = await gatewayFixture();
  const echo = createServer((socket) => socket.pipe(socket));
  const echoAddress = await listen(echo);
  const access = await gateway.createLease({ leaseId: "hgw_helpersecurity", deviceId: "had_helpersecurity", contractId: "hctr_helpersecurity", expiresAt: new Date(Date.now() + 300_000).toISOString() });
  const expiredFile = tokenFile(access.buyerAccess.token);
  try {
    const expired = await run(process.execPath, helperArgs(access, expiredFile.path, new Date(Date.now() - 1_000).toISOString()));
    assert.equal(expired.code, 64);
    assert.match(expired.stderr.toString(), /已过期/u);
    assert.equal(expired.stderr.toString().includes(access.buyerAccess.token), false);
    assert.throws(() => readFileSync(expiredFile.path), /ENOENT/u);

    const replay = await run(process.execPath, helperArgs(access, expiredFile.path));
    assert.equal(replay.code, 64);
    assert.equal(replay.stderr.toString().includes(access.buyerAccess.token), false);

    const rotated = await gateway.issueBuyerToken(access.leaseId);
    let markWaiting;
    const waiting = new Promise((resolveWaiting) => { markWaiting = resolveWaiting; });
    const slot = openGatewaySlot({
      allowPlaintext: true, gatewayHost: "127.0.0.1", gatewayPort: access.agentTunnel.port,
      leaseId: access.leaseId, ticket: access.agentTunnel.ticket, targetHost: "127.0.0.1", targetPort: echoAddress.port,
      onWaiting: markWaiting,
    });
    await waiting;
    const oldFile = tokenFile(access.buyerAccess.token);
    const old = await run(process.execPath, helperArgs(access, oldFile.path), "old-token");
    assert.equal(old.stdout.length, 0);
    assert.equal(old.stderr.toString().includes(access.buyerAccess.token), false);
    rmSync(oldFile.directory, { recursive: true, force: true });

    const currentFile = tokenFile(rotated.token);
    const currentPayload = "current-token";
    const current = await run(process.execPath, helperArgs({ ...access, expiresAt: rotated.expiresAt }, currentFile.path), currentPayload, { endAfterOutputBytes: Buffer.byteLength(currentPayload) });
    assert.equal(current.stdout.toString(), "current-token");
    rmSync(currentFile.directory, { recursive: true, force: true });
    const pair = await slot;
    pair.gateway.destroy(); pair.target.destroy();

    await gateway.revokeLease(access.leaseId, "BUYER_HELPER_TEST");
    const revokedFile = tokenFile(rotated.token);
    const revoked = await run(process.execPath, helperArgs(access, revokedFile.path), "revoked-token");
    assert.notEqual(revoked.code, 0);
    assert.equal(revoked.stderr.toString().includes(rotated.token), false);
    rmSync(revokedFile.directory, { recursive: true, force: true });
  } finally {
    rmSync(expiredFile.directory, { recursive: true, force: true });
    await gateway.stop(); echo.close();
  }
});
