import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { dirname } from "node:path";
import { createServer as createTlsServer } from "node:tls";
import { DatabaseSync } from "node:sqlite";

const ID_PATTERN = /^[a-z][a-z0-9_]{5,95}$/u;
const MAX_CONTROL_BODY = 32 * 1024;
const MAX_HANDSHAKE = 4 * 1024;

export class AccessGatewayError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AccessGatewayError";
    this.code = code;
    this.status = status;
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_CONTROL_BODY) throw new AccessGatewayError("BODY_TOO_LARGE", "Control request body is too large.", 413);
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    return parsed;
  } catch {
    throw new AccessGatewayError("BODY_INVALID", "Control request body must be a JSON object.");
  }
}

function validateId(value, field) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new AccessGatewayError("FIELD_INVALID", `${field} is invalid.`);
  return value;
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(server.address()); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function close(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } };
    const timer = setTimeout(done, 500);
    server.close(done);
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

export class KaiAccessGateway {
  constructor(options) {
    this.options = {
      controlHost: "127.0.0.1",
      controlPort: 0,
      tunnelHost: "0.0.0.0",
      tunnelPort: 7443,
      buyerHost: "0.0.0.0",
      publicHost: "gateway.invalid",
      publicPortStart: 22000,
      publicPortEnd: 22999,
      allowPlaintextTunnel: false,
      buyerHandshakeTimeoutMs: 5_000,
      buyerMaxConnectionsPerLease: 4,
      buyerMaxPendingAuthPerLease: 8,
      buyerAuthRateLimitPerMinute: 30,
      buyerTokenTtlMs: 5 * 60_000,
      now: () => new Date(),
      ...options,
    };
    if (typeof this.options.controlToken !== "string" || this.options.controlToken.length < 32) throw new Error("KAI_GATEWAY_CONTROL_TOKEN must contain at least 32 characters.");
    if (typeof this.options.ticketPepper !== "string" || this.options.ticketPepper.length < 32) throw new Error("KAI_GATEWAY_TICKET_PEPPER must contain at least 32 characters.");
    if (this.options.publicPortStart !== 0 && (!Number.isInteger(this.options.publicPortStart) || !Number.isInteger(this.options.publicPortEnd)
      || this.options.publicPortStart < 1024 || this.options.publicPortEnd > 65535 || this.options.publicPortEnd < this.options.publicPortStart
      || this.options.publicPortEnd - this.options.publicPortStart > 9999)) throw new Error("KAI_GATEWAY_PUBLIC_PORT_RANGE is invalid.");
    if (!this.options.allowPlaintextTunnel && (!this.options.tlsCertPath || !this.options.tlsKeyPath)) throw new Error("Gateway tunnel TLS certificate and key are required.");
    const dbPath = this.options.dbPath;
    if (!dbPath) throw new Error("KAI_GATEWAY_DB_PATH is required.");
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true, mode: 0o750 });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS gateway_leases (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      contract_id TEXT NOT NULL UNIQUE,
      public_port INTEGER NOT NULL UNIQUE,
      ticket_digest TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED','EXPIRED')),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    ); CREATE INDEX IF NOT EXISTS gateway_leases_status_expiry_idx ON gateway_leases(status,expires_at);`);
    const leaseColumns = new Set(this.db.prepare("PRAGMA table_info(gateway_leases)").all().map((column) => String(column.name)));
    if (!leaseColumns.has("buyer_token_digest")) this.db.exec("ALTER TABLE gateway_leases ADD COLUMN buyer_token_digest TEXT");
    if (!leaseColumns.has("buyer_token_expires_at")) this.db.exec("ALTER TABLE gateway_leases ADD COLUMN buyer_token_expires_at TEXT");
    this.controlServer = null;
    this.tunnelServer = null;
    this.buyerServers = new Map();
    this.pendingAgents = new Map();
    this.pendingBuyerAuth = new Map();
    this.buyerAuthAttempts = new Map();
    this.activeSockets = new Map();
    this.expiryTimer = null;
  }

  ticketDigest(ticket) {
    return createHmac("sha256", this.options.ticketPepper).update(ticket).digest("hex");
  }

  buyerTokenDigest(token) {
    return createHmac("sha256", this.options.ticketPepper).update(`buyer:${token}`).digest("hex");
  }

  log(event, metadata = {}) {
    this.options.logger?.({ level: "info", event, occurredAt: this.options.now().toISOString(), ...metadata });
  }

  lease(id) {
    return this.db.prepare("SELECT * FROM gateway_leases WHERE id=?").get(id) ?? null;
  }

  activeLease(id) {
    const row = this.lease(id);
    if (!row || row.status !== "ACTIVE" || Date.parse(row.expires_at) <= this.options.now().getTime()) return null;
    return row;
  }

  allocatePort() {
    if (this.options.publicPortStart === 0) return 0;
    const used = new Set(this.db.prepare("SELECT public_port FROM gateway_leases WHERE status='ACTIVE'").all().map((row) => Number(row.public_port)));
    for (let port = this.options.publicPortStart; port <= this.options.publicPortEnd; port += 1) if (!used.has(port)) return port;
    throw new AccessGatewayError("PORT_CAPACITY_EXHAUSTED", "No KAI Access Gateway buyer port is available.", 503);
  }

  async startBuyerListener(leaseId, requestedPort) {
    const server = createTcpServer((buyer) => this.acceptBuyer(leaseId, buyer));
    server.on("error", (error) => this.log("gateway.buyer_listener_error", { leaseId, errorCode: error.code ?? "UNKNOWN" }));
    const address = await listen(server, requestedPort, this.options.buyerHost);
    const publicPort = typeof address === "object" && address ? address.port : requestedPort;
    this.buyerServers.set(leaseId, server);
    return publicPort;
  }

  async createLease(input) {
    const leaseId = validateId(input.leaseId, "leaseId");
    const deviceId = validateId(input.deviceId, "deviceId");
    const contractId = validateId(input.contractId, "contractId");
    const expiresAt = typeof input.expiresAt === "string" ? input.expiresAt : "";
    const expires = Date.parse(expiresAt);
    const now = this.options.now();
    if (!Number.isFinite(expires) || expires <= now.getTime() + 60_000 || expires > now.getTime() + 32 * 24 * 60 * 60_000) {
      throw new AccessGatewayError("EXPIRY_INVALID", "Gateway lease expiry must be between one minute and 32 days from now.");
    }
    const existing = this.lease(leaseId) ?? this.db.prepare("SELECT * FROM gateway_leases WHERE contract_id=?").get(contractId) ?? null;
    if (existing) {
      if (existing.id !== leaseId || existing.device_id !== deviceId || existing.contract_id !== contractId) {
        throw new AccessGatewayError("LEASE_CONFLICT", "Gateway lease or contract already exists with different immutable fields.", 409);
      }
      if (!this.activeLease(leaseId)) throw new AccessGatewayError("LEASE_NOT_ACTIVE", "Gateway lease is expired or revoked and cannot be reopened.", 409);
      const [agentTicket, issuedBuyerAccess] = await Promise.all([this.issueTicket(leaseId), this.issueBuyerToken(leaseId)]);
      const buyerAccess = { version: issuedBuyerAccess.version, leaseId: issuedBuyerAccess.leaseId, token: issuedBuyerAccess.token, expiresAt: issuedBuyerAccess.expiresAt };
      this.log("gateway.lease_create_replayed", { leaseId, deviceId, contractId });
      return this.leaseResponse(this.activeLease(leaseId), agentTicket.ticket, buyerAccess);
    }
    const ticket = randomBytes(32).toString("base64url");
    const buyerToken = randomBytes(32).toString("base64url");
    const buyerTokenExpiresAt = new Date(Math.min(expires, now.getTime() + this.options.buyerTokenTtlMs)).toISOString();
    const requestedPort = this.allocatePort();
    const publicPort = await this.startBuyerListener(leaseId, requestedPort);
    try {
      this.db.prepare(`INSERT INTO gateway_leases(id,device_id,contract_id,public_port,ticket_digest,buyer_token_digest,buyer_token_expires_at,status,expires_at,created_at)
        VALUES(?,?,?,?,?,?,?,'ACTIVE',?,?)`).run(leaseId, deviceId, contractId, publicPort, this.ticketDigest(ticket), this.buyerTokenDigest(buyerToken), buyerTokenExpiresAt, expiresAt, now.toISOString());
    } catch (error) {
      await close(this.buyerServers.get(leaseId));
      this.buyerServers.delete(leaseId);
      throw error;
    }
    this.log("gateway.lease_created", { leaseId, deviceId, contractId, publicPort, expiresAt });
    return this.leaseResponse(this.activeLease(leaseId), ticket, { version: 1, leaseId, token: buyerToken, expiresAt: buyerTokenExpiresAt });
  }

  leaseResponse(lease, ticket, buyerAccess) {
    return {
      version: 1,
      leaseId: String(lease.id),
      deviceId: String(lease.device_id),
      contractId: String(lease.contract_id),
      expiresAt: String(lease.expires_at),
      buyerEndpoint: `${this.options.publicHost}:${Number(lease.public_port)}`,
      buyerAccess,
      agentTunnel: { host: this.options.publicHost, port: this.tunnelAddress().port, ticket },
    };
  }

  async revokeLease(leaseId, reason = "CONTROL_PLANE_REVOKED") {
    const row = this.lease(leaseId);
    if (!row) throw new AccessGatewayError("LEASE_NOT_FOUND", "Gateway lease was not found.", 404);
    if (row.status !== "ACTIVE") return row;
    const now = this.options.now().toISOString();
    this.db.prepare("UPDATE gateway_leases SET status='REVOKED',revoked_at=? WHERE id=? AND status='ACTIVE'").run(now, leaseId);
    await this.stopLeaseSockets(leaseId);
    this.log("gateway.lease_revoked", { leaseId, reason });
    return this.lease(leaseId);
  }

  async issueTicket(leaseId) {
    const lease = this.activeLease(leaseId);
    if (!lease) throw new AccessGatewayError("LEASE_NOT_ACTIVE", "Gateway lease is missing, expired or revoked.", 409);
    const ticket = randomBytes(32).toString("base64url");
    this.db.prepare("UPDATE gateway_leases SET ticket_digest=? WHERE id=? AND status='ACTIVE'").run(this.ticketDigest(ticket), leaseId);
    for (const socket of this.pendingAgents.get(leaseId) ?? []) socket.destroy();
    this.pendingAgents.delete(leaseId);
    this.log("gateway.ticket_rotated", { leaseId, deviceId: lease.device_id });
    return { version: 1, leaseId, ticket, expiresAt: lease.expires_at, agentTunnel: this.tunnelAddress() };
  }

  async issueBuyerToken(leaseId) {
    const lease = this.activeLease(leaseId);
    if (!lease) throw new AccessGatewayError("LEASE_NOT_ACTIVE", "Gateway lease is missing, expired or revoked.", 409);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Math.min(Date.parse(lease.expires_at), this.options.now().getTime() + this.options.buyerTokenTtlMs)).toISOString();
    this.db.prepare("UPDATE gateway_leases SET buyer_token_digest=?,buyer_token_expires_at=? WHERE id=? AND status='ACTIVE'")
      .run(this.buyerTokenDigest(token), expiresAt, leaseId);
    this.log("gateway.buyer_token_rotated", { leaseId, contractId: lease.contract_id, expiresAt });
    return { version: 1, leaseId, token, expiresAt, buyerEndpoint: `${this.options.publicHost}:${Number(lease.public_port)}` };
  }

  leaseStatus(leaseId) {
    const lease = this.lease(leaseId);
    if (!lease) throw new AccessGatewayError("LEASE_NOT_FOUND", "Gateway lease was not found.", 404);
    const active = lease.status === "ACTIVE" && Date.parse(lease.expires_at) > this.options.now().getTime();
    const authenticatedAgentSlots = active ? (this.pendingAgents.get(leaseId) ?? []).filter((socket) => !socket.destroyed).length : 0;
    const activeConnections = active ? Math.floor((this.activeSockets.get(leaseId)?.size ?? 0) / 2) : 0;
    return {
      version: 1,
      leaseId,
      status: active ? "ACTIVE" : lease.status === "ACTIVE" ? "EXPIRED" : String(lease.status),
      authenticatedAgentSlots,
      activeConnections,
      expiresAt: String(lease.expires_at),
    };
  }

  async expireLeases() {
    const now = this.options.now().toISOString();
    const expired = this.db.prepare("SELECT id FROM gateway_leases WHERE status='ACTIVE' AND expires_at<=?").all(now);
    for (const row of expired) {
      const leaseId = String(row.id);
      this.db.prepare("UPDATE gateway_leases SET status='EXPIRED',revoked_at=? WHERE id=? AND status='ACTIVE'").run(now, leaseId);
      await this.stopLeaseSockets(leaseId);
      this.log("gateway.lease_expired", { leaseId });
    }
  }

  async stopLeaseSockets(leaseId) {
    await close(this.buyerServers.get(leaseId));
    this.buyerServers.delete(leaseId);
    for (const socket of this.pendingAgents.get(leaseId) ?? []) socket.destroy();
    this.pendingAgents.delete(leaseId);
    for (const socket of this.activeSockets.get(leaseId) ?? []) socket.destroy();
    this.activeSockets.delete(leaseId);
    this.pendingBuyerAuth.delete(leaseId);
  }

  acceptAgent(socket) {
    socket.setTimeout(15_000, () => socket.destroy());
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_HANDSHAKE) return socket.destroy();
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      socket.off("data", onData);
      let handshake;
      try { handshake = JSON.parse(buffer.subarray(0, newline).toString("utf8")); }
      catch { return socket.destroy(); }
      const leaseId = typeof handshake?.leaseId === "string" ? handshake.leaseId : "";
      const ticket = typeof handshake?.ticket === "string" ? handshake.ticket : "";
      const lease = this.activeLease(leaseId);
      if (!lease || handshake.version !== 1 || !safeEqual(this.ticketDigest(ticket), lease.ticket_digest)) return socket.destroy();
      socket.setTimeout(0);
      const pending = this.pendingAgents.get(leaseId) ?? [];
      pending.push(socket);
      this.pendingAgents.set(leaseId, pending);
      socket.once("close", () => {
        const current = this.pendingAgents.get(leaseId) ?? [];
        this.pendingAgents.set(leaseId, current.filter((candidate) => candidate !== socket));
      });
      socket.write("WAITING\n");
      this.log("gateway.agent_slot_ready", { leaseId, deviceId: lease.device_id });
    };
    socket.on("data", onData);
  }

  buyerRateAllowed(leaseId, remoteAddress) {
    const now = this.options.now().getTime();
    const key = `${leaseId}:${remoteAddress || "unknown"}`;
    if (this.buyerAuthAttempts.size > 4_096) {
      for (const [candidate, timestamps] of this.buyerAuthAttempts) {
        if (!timestamps.some((value) => value > now - 60_000)) this.buyerAuthAttempts.delete(candidate);
      }
      if (this.buyerAuthAttempts.size > 4_096 && !this.buyerAuthAttempts.has(key)) return false;
    }
    const recent = (this.buyerAuthAttempts.get(key) ?? []).filter((value) => value > now - 60_000);
    if (recent.length >= this.options.buyerAuthRateLimitPerMinute) return false;
    recent.push(now);
    this.buyerAuthAttempts.set(key, recent);
    return true;
  }

  pairBuyer(leaseId, buyer, initialPayload = Buffer.alloc(0)) {
    const lease = this.activeLease(leaseId);
    if (!lease) return buyer.destroy();
    const active = this.activeSockets.get(leaseId) ?? new Set();
    if (active.size / 2 >= this.options.buyerMaxConnectionsPerLease) return buyer.destroy();
    const pending = this.pendingAgents.get(leaseId) ?? [];
    const agent = pending.shift();
    this.pendingAgents.set(leaseId, pending);
    if (!agent || agent.destroyed) {
      buyer.end("KAI Access Gateway: capacity is starting; retry shortly.\r\n");
      return;
    }
    active.add(buyer); active.add(agent);
    this.activeSockets.set(leaseId, active);
    const release = () => { active.delete(buyer); active.delete(agent); };
    buyer.once("close", release); agent.once("close", release);
    agent.write("CONNECT\n", () => {
      if (initialPayload.length) agent.write(initialPayload);
      buyer.pipe(agent);
      agent.pipe(buyer);
    });
    this.log("gateway.buyer_connected", { leaseId, contractId: lease.contract_id });
  }

  acceptBuyer(leaseId, buyer) {
    const lease = this.activeLease(leaseId);
    if (!lease || !this.buyerRateAllowed(leaseId, buyer.remoteAddress)) return buyer.destroy();
    const pendingCount = this.pendingBuyerAuth.get(leaseId) ?? 0;
    if (pendingCount >= this.options.buyerMaxPendingAuthPerLease) return buyer.destroy();
    this.pendingBuyerAuth.set(leaseId, pendingCount + 1);
    let released = false;
    const releasePending = () => {
      if (released) return;
      released = true;
      const current = this.pendingBuyerAuth.get(leaseId) ?? 1;
      if (current <= 1) this.pendingBuyerAuth.delete(leaseId);
      else this.pendingBuyerAuth.set(leaseId, current - 1);
    };
    buyer.setTimeout(this.options.buyerHandshakeTimeoutMs, () => buyer.destroy());
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_HANDSHAKE) return buyer.destroy();
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      buyer.off("data", onData);
      let handshake;
      try { handshake = JSON.parse(buffer.subarray(0, newline).toString("utf8")); }
      catch { return buyer.destroy(); }
      const currentLease = this.activeLease(leaseId);
      const token = typeof handshake?.token === "string" ? handshake.token : "";
      const authenticated = currentLease && handshake.version === 1 && handshake.leaseId === leaseId
        && typeof currentLease.buyer_token_digest === "string" && typeof currentLease.buyer_token_expires_at === "string"
        && Date.parse(currentLease.buyer_token_expires_at) > this.options.now().getTime()
        && safeEqual(this.buyerTokenDigest(token), currentLease.buyer_token_digest);
      if (!authenticated) return buyer.destroy();
      releasePending();
      buyer.setTimeout(0);
      this.pairBuyer(leaseId, buyer, buffer.subarray(newline + 1));
    };
    buyer.once("close", releasePending);
    buyer.on("data", onData);
  }

  async handleControl(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://gateway.local");
      if (request.method === "GET" && url.pathname === "/health") {
        const health = this.healthSnapshot();
        return json(response, health.status === "ok" ? 200 : 503, health);
      }
      const bearer = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : "";
      if (!safeEqual(bearer, this.options.controlToken)) throw new AccessGatewayError("CONTROL_UNAUTHORIZED", "Gateway control authentication failed.", 401);
      if (request.method === "POST" && url.pathname === "/v1/leases") return json(response, 201, await this.createLease(await requestBody(request)));
      const ticketMatch = /^\/v1\/leases\/([a-z][a-z0-9_]{5,95})\/tickets$/u.exec(url.pathname);
      if (request.method === "POST" && ticketMatch) return json(response, 201, await this.issueTicket(ticketMatch[1]));
      const buyerTokenMatch = /^\/v1\/leases\/([a-z][a-z0-9_]{5,95})\/buyer-tokens$/u.exec(url.pathname);
      if (request.method === "POST" && buyerTokenMatch) return json(response, 201, await this.issueBuyerToken(buyerTokenMatch[1]));
      const statusMatch = /^\/v1\/leases\/([a-z][a-z0-9_]{5,95})\/status$/u.exec(url.pathname);
      if (request.method === "GET" && statusMatch) return json(response, 200, this.leaseStatus(statusMatch[1]));
      const match = /^\/v1\/leases\/([a-z][a-z0-9_]{5,95})$/u.exec(url.pathname);
      if (request.method === "DELETE" && match) {
        const body = await requestBody(request);
        return json(response, 200, { lease: await this.revokeLease(match[1], typeof body.reason === "string" ? body.reason.slice(0, 80) : undefined) });
      }
      throw new AccessGatewayError("ROUTE_NOT_FOUND", "Gateway control route was not found.", 404);
    } catch (error) {
      const known = error instanceof AccessGatewayError;
      json(response, known ? error.status : 500, { error: { code: known ? error.code : "GATEWAY_INTERNAL_ERROR", message: known ? error.message : "Gateway control request failed." } });
    }
  }

  tunnelAddress() {
    const address = this.tunnelServer?.address();
    if (!address || typeof address === "string") return { host: this.options.publicHost, port: this.options.tunnelPort };
    return { host: this.options.publicHost, port: address.port };
  }

  controlAddress() {
    const address = this.controlServer?.address();
    if (!address || typeof address === "string") return null;
    return address;
  }

  healthSnapshot() {
    let integrity = "error";
    let activeLeases = 0;
    try { integrity = String(this.db.prepare("PRAGMA quick_check").get()?.quick_check ?? "error"); }
    catch { integrity = "error"; }
    const tunnelListening = Boolean(this.tunnelServer?.listening);
    if (integrity === "ok") {
      try { activeLeases = Number(this.db.prepare("SELECT COUNT(*) count FROM gateway_leases WHERE status='ACTIVE' AND expires_at>?").get(this.options.now().toISOString())?.count ?? 0); }
      catch { integrity = "error"; }
    }
    const authenticatedAgentSlots = [...this.pendingAgents.values()].reduce((total, sockets) => total + sockets.filter((socket) => !socket.destroyed).length, 0);
    const activeConnections = [...this.activeSockets.values()].reduce((total, sockets) => total + Math.floor(sockets.size / 2), 0);
    const healthy = integrity === "ok" && tunnelListening;
    return {
      status: healthy ? "ok" : "unavailable",
      service: "kai-access-gateway",
      databaseIntegrity: integrity,
      tunnelListening,
      tunnelPort: this.tunnelAddress().port,
      activeLeases,
      authenticatedAgentSlots,
      activeConnections,
      checkedAt: this.options.now().toISOString(),
    };
  }

  async start() {
    const now = this.options.now().toISOString();
    this.db.prepare("UPDATE gateway_leases SET status='EXPIRED' WHERE status='ACTIVE' AND expires_at<=?").run(now);
    const tunnelHandler = (socket) => this.acceptAgent(socket);
    this.tunnelServer = this.options.allowPlaintextTunnel
      ? createTcpServer(tunnelHandler)
      : createTlsServer({ cert: readFileSync(this.options.tlsCertPath), key: readFileSync(this.options.tlsKeyPath), minVersion: "TLSv1.3" }, tunnelHandler);
    this.tunnelServer.on("error", (error) => this.log("gateway.tunnel_listener_error", { errorCode: error.code ?? "UNKNOWN" }));
    await listen(this.tunnelServer, this.options.tunnelPort, this.options.tunnelHost);
    const active = this.db.prepare("SELECT id,public_port FROM gateway_leases WHERE status='ACTIVE' AND expires_at>?").all(now);
    for (const lease of active) await this.startBuyerListener(String(lease.id), Number(lease.public_port));
    this.controlServer = createHttpServer((request, response) => void this.handleControl(request, response));
    await listen(this.controlServer, this.options.controlPort, this.options.controlHost);
    this.expiryTimer = setInterval(() => void this.expireLeases().catch((error) => this.log("gateway.expiry_sweep_failed", { errorCode: error.code ?? "UNKNOWN" })), 30_000);
    this.expiryTimer.unref();
    this.log("gateway.started", { tunnelPort: this.tunnelAddress().port, activeLeases: active.length });
    return { control: this.controlAddress(), tunnel: this.tunnelAddress() };
  }

  async stop() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.expiryTimer = null;
    for (const leaseId of [...this.buyerServers.keys()]) await this.stopLeaseSockets(leaseId);
    await Promise.all([close(this.controlServer), close(this.tunnelServer)]);
    this.db.close();
  }
}
