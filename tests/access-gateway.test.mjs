import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { KaiAccessGateway } from "../access-gateway/src/gateway.mjs";
import { openGatewaySlot } from "../access-gateway/src/agent-client.mjs";
import { openGatewaySlot as openHostAgentGatewaySlot } from "../host-agent/src/gateway-client.mjs";
import { AccessGatewayClient } from "../lib/server/access-gateway-client.ts";
import { prepareHostingGatewayCommand, revokeHostingGatewayBeforeCancellation } from "../lib/server/hosting-access-gateway.ts";
import { resumeGatewayBindings, stopGatewayBindings } from "../host-agent/src/client.mjs";
import { saveGatewayBinding } from "../host-agent/src/state.mjs";

const TOKEN = "control-token-for-tests-that-is-long-enough";
const PEPPER = "ticket-pepper-for-tests-that-is-long-enough";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

async function openBuyer(access, payload = "") {
  const buyer = createConnection({ host: "127.0.0.1", port: Number(access.buyerEndpoint.split(":").at(-1)) });
  await once(buyer, "connect");
  buyer.write(`${JSON.stringify({ version: 1, leaseId: access.leaseId, token: access.buyerAccess?.token ?? access.token })}\n${payload}`);
  return buyer;
}

test("NAT host can serve a buyer through an outbound-only gateway slot and revocation closes it", async () => {
  const echo = createServer((socket) => socket.pipe(socket));
  const echoAddress = await listen(echo);
  const gateway = new KaiAccessGateway({
    dbPath: ":memory:", controlToken: TOKEN, ticketPepper: PEPPER,
    publicHost: "127.0.0.1", controlHost: "127.0.0.1", controlPort: 0,
    tunnelHost: "127.0.0.1", tunnelPort: 0, buyerHost: "127.0.0.1",
    publicPortStart: 0, publicPortEnd: 0, allowPlaintextTunnel: true,
  });
  const addresses = await gateway.start();
  const controlOrigin = `http://127.0.0.1:${addresses.control.port}`;
  try {
    const created = await fetch(`${controlOrigin}/v1/leases`, {
      method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ leaseId: "hgw_testlease", deviceId: "had_testdevice", contractId: "hctr_testcontract", expiresAt: new Date(Date.now() + 300_000).toISOString() }),
    });
    assert.equal(created.status, 201);
    const lease = await created.json();
    assert.equal(lease.buyerEndpoint.startsWith("127.0.0.1:"), true);
    let markWaiting;
    const waiting = new Promise((resolve) => { markWaiting = resolve; });
    const slotPromise = openGatewaySlot({
      allowPlaintext: true, gatewayHost: "127.0.0.1", gatewayPort: lease.agentTunnel.port,
      leaseId: lease.leaseId, ticket: lease.agentTunnel.ticket, targetHost: "127.0.0.1", targetPort: echoAddress.port,
      onWaiting: markWaiting,
    });
    await waiting;
    const buyerPort = Number(lease.buyerEndpoint.split(":").at(-1));
    const buyer = await openBuyer(lease, "hello-h100");
    const received = once(buyer, "data");
    assert.equal((await received)[0].toString("utf8"), "hello-h100");
    const pair = await slotPromise;
    buyer.destroy(); pair.gateway.destroy(); pair.target.destroy();

    const revoked = await fetch(`${controlOrigin}/v1/leases/${lease.leaseId}`, {
      method: "DELETE", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ reason: "TEST_COMPLETE" }),
    });
    assert.equal(revoked.status, 200);
    await assert.rejects(new Promise((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: buyerPort });
      socket.once("connect", resolve); socket.once("error", reject);
    }));
  } finally {
    await gateway.stop();
    echo.close();
  }
});

test("gateway control and agent tickets fail closed", async () => {
  const gateway = new KaiAccessGateway({
    dbPath: ":memory:", controlToken: TOKEN, ticketPepper: PEPPER,
    publicHost: "127.0.0.1", controlHost: "127.0.0.1", controlPort: 0,
    tunnelHost: "127.0.0.1", tunnelPort: 0, buyerHost: "127.0.0.1",
    publicPortStart: 0, publicPortEnd: 0, allowPlaintextTunnel: true,
  });
  const addresses = await gateway.start();
  try {
    const unauthorized = await fetch(`http://127.0.0.1:${addresses.control.port}/v1/leases`, { method: "POST", body: "{}" });
    assert.equal(unauthorized.status, 401);
    const lease = await gateway.createLease({ leaseId: "hgw_badslot", deviceId: "had_badslot", contractId: "hctr_badslot", expiresAt: new Date(Date.now() + 300_000).toISOString() });
    await assert.rejects(openGatewaySlot({ allowPlaintext: true, gatewayHost: "127.0.0.1", gatewayPort: lease.agentTunnel.port, leaseId: lease.leaseId, ticket: "wrong-ticket", targetPort: 22, handshakeTimeoutMs: 1_000 }));
    const rotated = await gateway.issueTicket(lease.leaseId);
    assert.notEqual(rotated.ticket, lease.agentTunnel.ticket);
    await assert.rejects(openGatewaySlot({ allowPlaintext: true, gatewayHost: "127.0.0.1", gatewayPort: lease.agentTunnel.port, leaseId: lease.leaseId, ticket: lease.agentTunnel.ticket, targetPort: 22, handshakeTimeoutMs: 1_000 }));
  } finally { await gateway.stop(); }
});

test("Gateway health reports durable readiness and fails when the tunnel listener is unavailable", async () => {
  const gateway = new KaiAccessGateway({
    dbPath: ":memory:", controlToken: TOKEN, ticketPepper: PEPPER,
    publicHost: "127.0.0.1", controlHost: "127.0.0.1", controlPort: 0,
    tunnelHost: "127.0.0.1", tunnelPort: 0, buyerHost: "127.0.0.1",
    publicPortStart: 0, publicPortEnd: 0, allowPlaintextTunnel: true,
  });
  const addresses = await gateway.start();
  const origin = `http://127.0.0.1:${addresses.control.port}`;
  try {
    const initial = await fetch(`${origin}/health`);
    assert.equal(initial.status, 200);
    const initialBody = await initial.json();
    assert.match(initialBody.checkedAt, /^\d{4}-\d{2}-\d{2}T/u);
    assert.deepEqual(initialBody, {
      status: "ok",
      service: "kai-access-gateway",
      databaseIntegrity: "ok",
      tunnelListening: true,
      tunnelPort: addresses.tunnel.port,
      activeLeases: 0,
      authenticatedAgentSlots: 0,
      activeConnections: 0,
      checkedAt: initialBody.checkedAt,
    });
    await gateway.createLease({ leaseId: "hgw_health", deviceId: "had_health", contractId: "hctr_health", expiresAt: new Date(Date.now() + 300_000).toISOString() });
    const active = await fetch(`${origin}/health`);
    assert.equal((await active.json()).activeLeases, 1);
    await new Promise((resolve) => gateway.tunnelServer.close(resolve));
    const unavailable = await fetch(`${origin}/health`);
    assert.equal(unavailable.status, 503);
    const unavailableBody = await unavailable.json();
    assert.equal(unavailableBody.status, "unavailable");
    assert.equal(unavailableBody.tunnelListening, false);
  } finally { await gateway.stop(); }
});

test("unauthorized buyer connections never consume an Agent slot and replayed lease creation is idempotent", async () => {
  const echo = createServer((socket) => socket.pipe(socket));
  const echoAddress = await listen(echo);
  const gateway = new KaiAccessGateway({
    dbPath: ":memory:", controlToken: TOKEN, ticketPepper: PEPPER,
    publicHost: "127.0.0.1", controlHost: "127.0.0.1", controlPort: 0,
    tunnelHost: "127.0.0.1", tunnelPort: 0, buyerHost: "127.0.0.1",
    publicPortStart: 0, publicPortEnd: 0, allowPlaintextTunnel: true,
    buyerHandshakeTimeoutMs: 250, buyerMaxConnectionsPerLease: 1, buyerMaxPendingAuthPerLease: 2,
  });
  await gateway.start();
  try {
    const input = { leaseId: "hgw_antidos", deviceId: "had_antidos", contractId: "hctr_antidos", expiresAt: new Date(Date.now() + 300_000).toISOString() };
    const first = await gateway.createLease(input);
    const replay = await gateway.createLease(input);
    assert.equal(replay.leaseId, first.leaseId);
    assert.equal(replay.buyerEndpoint, first.buyerEndpoint);
    assert.notEqual(replay.agentTunnel.ticket, first.agentTunnel.ticket);
    assert.notEqual(replay.buyerAccess.token, first.buyerAccess.token);

    let markWaiting;
    const waiting = new Promise((resolve) => { markWaiting = resolve; });
    const slot = openGatewaySlot({
      allowPlaintext: true, gatewayHost: "127.0.0.1", gatewayPort: replay.agentTunnel.port,
      leaseId: replay.leaseId, ticket: replay.agentTunnel.ticket, targetHost: "127.0.0.1", targetPort: echoAddress.port,
      onWaiting: markWaiting,
    });
    await waiting;
    const unauthorized = createConnection({ host: "127.0.0.1", port: Number(replay.buyerEndpoint.split(":").at(-1)) });
    await once(unauthorized, "connect");
    const unauthorizedClosed = once(unauthorized, "close");
    unauthorized.write(`${JSON.stringify({ version: 1, leaseId: replay.leaseId, token: "invalid-buyer-token" })}\n`);
    await unauthorizedClosed;

    const buyer = await openBuyer(replay, "authorized-after-rejection");
    assert.equal((await once(buyer, "data"))[0].toString(), "authorized-after-rejection");
    const pair = await slot;
    buyer.destroy(); pair.gateway.destroy(); pair.target.destroy();
  } finally { await gateway.stop(); echo.close(); }
});

test("packaged Host Agent reaches a loopback workload through the gateway", async () => {
  const echo = createServer((socket) => socket.pipe(socket));
  const echoAddress = await listen(echo);
  const gateway = new KaiAccessGateway({
    dbPath: ":memory:", controlToken: TOKEN, ticketPepper: PEPPER,
    publicHost: "127.0.0.1", controlHost: "127.0.0.1", controlPort: 0,
    tunnelHost: "127.0.0.1", tunnelPort: 0, buyerHost: "127.0.0.1",
    publicPortStart: 0, publicPortEnd: 0, allowPlaintextTunnel: true,
  });
  await gateway.start();
  try {
    const lease = await gateway.createLease({ leaseId: "hgw_agenttest", deviceId: "had_agenttest", contractId: "hctr_agenttest", expiresAt: new Date(Date.now() + 300_000).toISOString() });
    let ready;
    const waiting = new Promise((resolve) => { ready = resolve; });
    const slot = openHostAgentGatewaySlot({
      version: 1, gatewayHost: "127.0.0.1", gatewayPort: lease.agentTunnel.port, serverName: "127.0.0.1",
      leaseId: lease.leaseId, ticket: lease.agentTunnel.ticket, targetPort: echoAddress.port, expiresAt: lease.expiresAt,
      allowPlaintextLocal: true, onWaiting: ready,
    });
    await waiting;
    const buyer = await openBuyer(lease, "host-agent-h100");
    const data = once(buyer, "data");
    assert.equal((await data)[0].toString(), "host-agent-h100");
    const pair = await slot;
    buyer.destroy(); pair.gateway.destroy(); pair.target.destroy();
  } finally { await gateway.stop(); echo.close(); }
});

test("the same Hosting contract creates its gateway lease before READY and revokes it before CLEANUP terminal state", async () => {
  const echo = createServer((socket) => socket.pipe(socket));
  const echoAddress = await listen(echo);
  const gateway = new KaiAccessGateway({
    dbPath: ":memory:", controlToken: TOKEN, ticketPepper: PEPPER,
    publicHost: "127.0.0.1", controlHost: "127.0.0.1", controlPort: 0,
    tunnelHost: "127.0.0.1", tunnelPort: 0, buyerHost: "127.0.0.1",
    publicPortStart: 0, publicPortEnd: 0, allowPlaintextTunnel: true,
  });
  const addresses = await gateway.start();
  const originalUrl = process.env.KAI_ACCESS_GATEWAY_CONTROL_URL;
  const originalToken = process.env.KAI_ACCESS_GATEWAY_CONTROL_TOKEN;
  process.env.KAI_ACCESS_GATEWAY_CONTROL_URL = `http://127.0.0.1:${addresses.control.port}`;
  process.env.KAI_ACCESS_GATEWAY_CONTROL_TOKEN = TOKEN;
  const clientLogs = [];
  const client = new AccessGatewayClient({ logger: (entry) => clientLogs.push(entry) });
  const contract = {
    id: "hctr_lifecycle", reservedSeconds: 180,
    snapshot: { acceptanceWindowSeconds: 300 },
  };
  const device = { id: "had_lifecycle", organizationId: "org_supplier", inventory: { sshPortStart: echoAddress.port } };
  let binding = null;
  const store = {
    async contractForViewer(organizationId, contractId) { assert.equal(organizationId, device.organizationId); assert.equal(contractId, contract.id); return contract; },
    async gatewayBinding(contractId) { assert.equal(contractId, contract.id); return binding; },
    async recordGatewayLease(input, now) { binding ??= { ...input, mode: "ACCESS_GATEWAY", status: "LEASE_CREATED", lastErrorCode: null, createdAt: now, slotConfirmedAt: null, revocationRequiredAt: null, revokedAt: null, updatedAt: now }; return binding; },
    async markGatewaySlotConfirmed(contractId, now) { binding = { ...binding, status: "SLOT_CONFIRMED", slotConfirmedAt: now, updatedAt: now }; return binding; },
    async markGatewayRevocationRequired(contractId, errorCode, now) { binding = { ...binding, status: "REVOCATION_REQUIRED", lastErrorCode: errorCode, revocationRequiredAt: now, updatedAt: now }; return binding; },
    async markGatewayRevoked(contractId, now) { binding = { ...binding, status: "REVOKED", lastErrorCode: null, revokedAt: now, updatedAt: now }; return binding; },
  };
  const provision = { id: "hac_provision", deviceId: device.id, contractId: contract.id, type: "PROVISION", status: "DELIVERED" };
  const cleanup = { id: "hac_cleanup", deviceId: device.id, contractId: contract.id, type: "CLEANUP", status: "DELIVERED" };
  try {
    const created = await prepareHostingGatewayCommand({ store, command: provision, device, outcome: "SUCCEEDED", now: new Date().toISOString(), client });
    assert.equal(created.action, "CREATED");
    assert.equal(created.readyForContract, false, "PROVISION must remain pending until an authenticated Agent slot exists");
    assert.equal(binding.status, "LEASE_CREATED");
    const replayedAfterLostResponse = await prepareHostingGatewayCommand({ store, command: provision, device, outcome: "SUCCEEDED", now: new Date().toISOString(), client });
    assert.equal(replayedAfterLostResponse.action, "CREATED");
    assert.equal(replayedAfterLostResponse.leaseId, created.leaseId);
    assert.notEqual(replayedAfterLostResponse.agentBundle.ticket, created.agentBundle.ticket, "a lost response rotates the undelivered Agent ticket without creating a second lease");
    let ready;
    const waiting = new Promise((resolve) => { ready = resolve; });
    const slot = openHostAgentGatewaySlot({ ...replayedAfterLostResponse.agentBundle, allowPlaintextLocal: true, onWaiting: ready });
    await waiting;
    const confirmed = await prepareHostingGatewayCommand({ store, command: provision, device, outcome: "SUCCEEDED", now: new Date().toISOString(), client });
    assert.equal(confirmed.action, "SLOT_CONFIRMED");
    assert.equal(confirmed.readyForContract, true);
    assert.equal(binding.status, "SLOT_CONFIRMED");
    const buyerAccess = await client.issueBuyerAccess(contract.id);
    const buyer = await openBuyer(buyerAccess, "same-contract-golden-loop");
    assert.equal((await once(buyer, "data"))[0].toString(), "same-contract-golden-loop");
    const pair = await slot;
    buyer.destroy(); pair.gateway.destroy(); pair.target.destroy();

    const revoked = await prepareHostingGatewayCommand({ store, command: cleanup, device, outcome: "SUCCEEDED", now: new Date().toISOString(), client });
    assert.equal(revoked.action, "REVOKED");
    assert.equal(binding.status, "REVOKED");
    await assert.rejects(new Promise((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: Number(buyerAccess.buyerEndpoint.split(":").at(-1)) });
      socket.once("connect", resolve); socket.once("error", reject);
    }));
    await client.revokeLease(contract.id, "IDEMPOTENT_REPLAY");
    const serializedLogs = JSON.stringify(clientLogs);
    assert.equal(serializedLogs.includes(TOKEN), false);
    assert.equal(serializedLogs.includes(created.agentBundle.ticket), false);
    assert.equal(serializedLogs.includes(buyerAccess.token), false);
    assert.equal(serializedLogs.includes(`127.0.0.1:${addresses.control.port}`), false);
  } finally {
    if (originalUrl === undefined) delete process.env.KAI_ACCESS_GATEWAY_CONTROL_URL; else process.env.KAI_ACCESS_GATEWAY_CONTROL_URL = originalUrl;
    if (originalToken === undefined) delete process.env.KAI_ACCESS_GATEWAY_CONTROL_TOKEN; else process.env.KAI_ACCESS_GATEWAY_CONTROL_TOKEN = originalToken;
    await gateway.stop(); echo.close();
  }
});

test("a persisted binding with lost Gateway configuration becomes REVOCATION_REQUIRED and blocks cancellation until retry", async () => {
  const originalUrl = process.env.KAI_ACCESS_GATEWAY_CONTROL_URL;
  const originalToken = process.env.KAI_ACCESS_GATEWAY_CONTROL_TOKEN;
  let binding = { contractId: "hctr_configlost", deviceId: "had_configlost", leaseId: "hgw_configlost", mode: "ACCESS_GATEWAY", status: "SLOT_CONFIRMED", buyerEndpoint: "gateway.invalid:22000", expiresAt: new Date(Date.now() + 300_000).toISOString(), lastErrorCode: null, createdAt: new Date().toISOString(), slotConfirmedAt: new Date().toISOString(), revocationRequiredAt: null, revokedAt: null, updatedAt: new Date().toISOString() };
  const store = {
    async gatewayBinding() { return binding; },
    async markGatewayRevocationRequired(_contractId, errorCode, now) { binding = { ...binding, status: "REVOCATION_REQUIRED", lastErrorCode: errorCode, revocationRequiredAt: now, updatedAt: now }; return binding; },
    async markGatewayRevoked(_contractId, now) { binding = { ...binding, status: "REVOKED", lastErrorCode: null, revokedAt: now, updatedAt: now }; return binding; },
  };
  delete process.env.KAI_ACCESS_GATEWAY_CONTROL_URL;
  delete process.env.KAI_ACCESS_GATEWAY_CONTROL_TOKEN;
  try {
    await assert.rejects(revokeHostingGatewayBeforeCancellation(store, binding.contractId, "CANCEL", new Date().toISOString()), (error) => error.code === "ACCESS_GATEWAY_CONFIGURATION_MISSING");
    assert.equal(binding.status, "REVOCATION_REQUIRED");
    assert.equal(binding.lastErrorCode, "ACCESS_GATEWAY_CONFIGURATION_MISSING");

    process.env.KAI_ACCESS_GATEWAY_CONTROL_URL = "https://gateway.invalid";
    process.env.KAI_ACCESS_GATEWAY_CONTROL_TOKEN = TOKEN;
    let revokedContractId = null;
    await revokeHostingGatewayBeforeCancellation(
      store,
      binding.contractId,
      "CANCEL_RETRY",
      new Date().toISOString(),
      { async revokeLease(contractId) { revokedContractId = contractId; } },
    );
    assert.equal(revokedContractId, binding.contractId);
    assert.equal(binding.status, "REVOKED");
    assert.equal(binding.lastErrorCode, null);
  } finally {
    if (originalUrl === undefined) delete process.env.KAI_ACCESS_GATEWAY_CONTROL_URL; else process.env.KAI_ACCESS_GATEWAY_CONTROL_URL = originalUrl;
    if (originalToken === undefined) delete process.env.KAI_ACCESS_GATEWAY_CONTROL_TOKEN; else process.env.KAI_ACCESS_GATEWAY_CONTROL_TOKEN = originalToken;
  }
});

test("Host Agent restores a 0600 persisted bundle after Agent and Gateway restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-gateway-recovery-"));
  const dbPath = join(directory, "gateway.sqlite");
  const bindingsFile = join(directory, "gateway-bindings.json");
  const probe = createServer();
  const probeAddress = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  const tunnelPort = probeAddress.port;
  const options = {
    dbPath, controlToken: TOKEN, ticketPepper: PEPPER,
    publicHost: "127.0.0.1", controlHost: "127.0.0.1", controlPort: 0,
    tunnelHost: "127.0.0.1", tunnelPort, buyerHost: "127.0.0.1",
    publicPortStart: 0, publicPortEnd: 0, allowPlaintextTunnel: true,
  };
  const first = new KaiAccessGateway(options);
  await first.start();
  const lease = await first.createLease({ leaseId: "hgw_restart", deviceId: "had_restart", contractId: "hctr_restart", expiresAt: new Date(Date.now() + 300_000).toISOString() });
  const bundle = { version: 1, gatewayHost: "127.0.0.1", gatewayPort: tunnelPort, serverName: "127.0.0.1", leaseId: lease.leaseId, ticket: lease.agentTunnel.ticket, targetPort: 2222, expiresAt: lease.expiresAt };
  await saveGatewayBinding("hctr_restart", bundle, bindingsFile);
  assert.equal((await stat(bindingsFile)).mode & 0o777, 0o600);
  await first.stop();
  const restarted = new KaiAccessGateway(options);
  await restarted.start();
  try {
    const resumed = await resumeGatewayBindings({ allowInsecureLocal: true, bindingsFile, onError: (error) => { throw error; } });
    assert.deepEqual(resumed, ["hctr_restart"]);
    assert.equal(restarted.leaseStatus(lease.leaseId).authenticatedAgentSlots >= 1, true);
  } finally {
    await restarted.revokeLease(lease.leaseId, "TEST_COMPLETE");
    await stopGatewayBindings();
    await restarted.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("server gateway client rejects invalid response shapes and times out without exposing its control token", async () => {
  const environment = {
    KAI_ACCESS_GATEWAY_CONTROL_URL: "https://gateway-control.invalid",
    KAI_ACCESS_GATEWAY_CONTROL_TOKEN: TOKEN,
    KAI_ACCESS_GATEWAY_CONTROL_TIMEOUT_MS: "250",
  };
  const invalid = new AccessGatewayClient({
    environment,
    logger: () => {},
    gatewayFetch: async () => new Response(JSON.stringify({ version: 1, unexpected: true }), { status: 201, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(
    invalid.createLease({ contractId: "hctr_invalidshape", deviceId: "had_invalidshape", expiresAt: new Date(Date.now() + 300_000).toISOString(), targetPort: 2222 }),
    (error) => error.code === "ACCESS_GATEWAY_RESPONSE_INVALID" && !error.message.includes(TOKEN),
  );
  const timeout = new AccessGatewayClient({
    environment,
    logger: () => {},
    gatewayFetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }),
  });
  await assert.rejects(
    timeout.createLease({ contractId: "hctr_timeouttest", deviceId: "had_timeouttest", expiresAt: new Date(Date.now() + 300_000).toISOString(), targetPort: 2222 }),
    (error) => error.code === "ACCESS_GATEWAY_TIMEOUT" && !error.message.includes(TOKEN),
  );
});
