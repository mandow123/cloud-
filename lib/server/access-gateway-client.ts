import { createHash } from "node:crypto";

const ID = /^[a-z][a-z0-9_]{5,95}$/u;
const HOST = /^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\[[0-9a-f:]+\])$/u;
const SECRET = /^[A-Za-z0-9_-]{40,128}$/u;
const MAX_RESPONSE_BYTES = 32 * 1024;

export class AccessGatewayClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 503, options?: ErrorOptions) {
    super(message, options);
    this.name = "AccessGatewayClientError";
    this.code = code;
    this.status = status;
  }
}

export type AccessGatewayCapability = Readonly<{
  configured: boolean;
  failClosed: true;
  natClosedLoop: boolean;
  reason?: "ACCESS_GATEWAY_CONFIGURATION_MISSING" | "ACCESS_GATEWAY_CONFIGURATION_INVALID";
}>;

export type AccessGatewayLease = Readonly<{
  leaseId: string;
  contractId: string;
  deviceId: string;
  expiresAt: string;
  buyerEndpoint: string;
  agentBundle: Readonly<{
    version: 1;
    gatewayHost: string;
    gatewayPort: number;
    serverName: string;
    leaseId: string;
    ticket: string;
    targetPort: number;
    expiresAt: string;
  }>;
}>;

export type AccessGatewayBuyerAccess = Readonly<{
  leaseId: string;
  buyerEndpoint: string;
  token: string;
  expiresAt: string;
}>;

export type AccessGatewayLeaseStatus = Readonly<{
  leaseId: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  authenticatedAgentSlots: number;
  activeConnections: number;
  expiresAt: string;
}>;

type GatewayConfiguration = Readonly<{ origin: string; token: string; timeoutMs: number }>;
type GatewayFetch = typeof fetch;

function configuration(environment: Record<string, string | undefined> = process.env): GatewayConfiguration | null {
  const rawOrigin = environment.KAI_ACCESS_GATEWAY_CONTROL_URL?.trim() ?? "";
  const token = environment.KAI_ACCESS_GATEWAY_CONTROL_TOKEN?.trim() ?? "";
  if (!rawOrigin && !token) return null;
  if (!rawOrigin || token.length < 32 || /[\s\x00-\x1f\x7f]/u.test(token)) {
    throw new AccessGatewayClientError("ACCESS_GATEWAY_CONFIGURATION_INVALID", "KAI Access Gateway 配置不完整。 ");
  }
  let url: URL;
  try { url = new URL(rawOrigin); }
  catch { throw new AccessGatewayClientError("ACCESS_GATEWAY_CONFIGURATION_INVALID", "KAI Access Gateway 控制地址无效。 "); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new AccessGatewayClientError("ACCESS_GATEWAY_CONFIGURATION_INVALID", "KAI Access Gateway 控制地址必须是无凭据、无路径参数的 HTTP(S) Origin。 ");
  }
  const timeoutCandidate = Number(environment.KAI_ACCESS_GATEWAY_CONTROL_TIMEOUT_MS ?? 3_000);
  const timeoutMs = Number.isSafeInteger(timeoutCandidate) && timeoutCandidate >= 250 && timeoutCandidate <= 10_000 ? timeoutCandidate : 3_000;
  return { origin: url.origin, token, timeoutMs };
}

export function accessGatewayCapability(environment: Record<string, string | undefined> = process.env): AccessGatewayCapability {
  try {
    const configured = Boolean(configuration(environment));
    return configured
      ? { configured: true, failClosed: true, natClosedLoop: true }
      : { configured: false, failClosed: true, natClosedLoop: false, reason: "ACCESS_GATEWAY_CONFIGURATION_MISSING" };
  } catch {
    return { configured: false, failClosed: true, natClosedLoop: false, reason: "ACCESS_GATEWAY_CONFIGURATION_INVALID" };
  }
}

export function accessGatewayLeaseId(contractId: string) {
  if (!ID.test(contractId)) throw new AccessGatewayClientError("ACCESS_GATEWAY_CONTRACT_ID_INVALID", "租赁合同标识无效。 ", 500);
  return `hgw_${createHash("sha256").update(contractId).digest("hex").slice(0, 40)}`;
}

function object(value: unknown, code = "ACCESS_GATEWAY_RESPONSE_INVALID"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccessGatewayClientError(code, "KAI Access Gateway 返回了无效响应。 ");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  if (Object.keys(value).sort().join(",") !== [...expected].sort().join(",")) {
    throw new AccessGatewayClientError("ACCESS_GATEWAY_RESPONSE_INVALID", "KAI Access Gateway 响应字段不符合协议。 ");
  }
}

function id(value: unknown, expected?: string) {
  if (typeof value !== "string" || !ID.test(value) || (expected && value !== expected)) throw new AccessGatewayClientError("ACCESS_GATEWAY_RESPONSE_INVALID", "KAI Access Gateway 响应标识不一致。 ");
  return value;
}

function timestamp(value: unknown, now = Date.now()) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= now || Date.parse(value) > now + 32 * 24 * 60 * 60_000) {
    throw new AccessGatewayClientError("ACCESS_GATEWAY_RESPONSE_INVALID", "KAI Access Gateway 响应有效期无效。 ");
  }
  return value;
}

function endpoint(value: unknown) {
  if (typeof value !== "string") throw new AccessGatewayClientError("ACCESS_GATEWAY_RESPONSE_INVALID", "KAI Access Gateway 买家入口无效。 ");
  const match = /^(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?):([0-9]{1,5})$/iu.exec(value);
  const port = Number(match?.[2] ?? 0);
  if (!match || port < 1 || port > 65535) throw new AccessGatewayClientError("ACCESS_GATEWAY_RESPONSE_INVALID", "KAI Access Gateway 买家入口无效。 ");
  return `${match[1].toLowerCase()}:${port}`;
}

async function boundedJson(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) throw new AccessGatewayClientError("ACCESS_GATEWAY_RESPONSE_INVALID", "KAI Access Gateway 返回了非 JSON 响应。 ");
  const reader = response.body?.getReader();
  if (!reader) throw new AccessGatewayClientError("ACCESS_GATEWAY_RESPONSE_INVALID", "KAI Access Gateway 返回了空响应。 ");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AccessGatewayClientError("ACCESS_GATEWAY_RESPONSE_TOO_LARGE", "KAI Access Gateway 响应超过安全限制。 ");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  try { return JSON.parse(body); }
  catch { throw new AccessGatewayClientError("ACCESS_GATEWAY_RESPONSE_INVALID", "KAI Access Gateway 返回了无法解析的响应。 "); }
}

export class AccessGatewayClient {
  readonly config: GatewayConfiguration;
  readonly gatewayFetch: GatewayFetch;
  readonly logger: (entry: Readonly<Record<string, string | number | boolean | undefined>>) => void;

  constructor(options: { environment?: Record<string, string | undefined>; gatewayFetch?: GatewayFetch; logger?: (entry: Readonly<Record<string, string | number | boolean | undefined>>) => void } = {}) {
    const config = configuration(options.environment);
    if (!config) throw new AccessGatewayClientError("ACCESS_GATEWAY_CONFIGURATION_MISSING", "KAI Access Gateway 未配置，NAT 上架闭环不可用。 ");
    this.config = config;
    this.gatewayFetch = options.gatewayFetch ?? fetch;
    this.logger = options.logger ?? ((entry) => console.info(JSON.stringify(entry)));
  }

  private log(event: string, metadata: Record<string, string | number | boolean | undefined>) {
    this.logger({ level: "info", event, ...metadata, occurredAt: new Date().toISOString() });
  }

  private async request(path: string, init: RequestInit, allowedStatuses: readonly number[]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Response;
    try {
      response = await this.gatewayFetch(`${this.config.origin}${path}`, {
        ...init,
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.config.token}`, "content-type": "application/json", accept: "application/json", ...(init.headers ?? {}) },
      });
    } catch (error) {
      const code = error instanceof Error && error.name === "AbortError" ? "ACCESS_GATEWAY_TIMEOUT" : "ACCESS_GATEWAY_UNREACHABLE";
      throw new AccessGatewayClientError(code, "KAI Access Gateway 暂时不可用，合同状态未推进。 ", 503, { cause: error });
    } finally { clearTimeout(timer); }
    const payload = await boundedJson(response);
    if (!allowedStatuses.includes(response.status)) {
      const errorBody = object(payload);
      const gatewayError = typeof object(errorBody.error).code === "string" ? String(object(errorBody.error).code) : "UNKNOWN";
      throw new AccessGatewayClientError("ACCESS_GATEWAY_REJECTED", `KAI Access Gateway 拒绝操作（${gatewayError}），合同状态未推进。 `, response.status >= 500 ? 503 : 409);
    }
    return payload;
  }

  async createLease(input: { contractId: string; deviceId: string; expiresAt: string; targetPort: number }): Promise<AccessGatewayLease> {
    const leaseId = accessGatewayLeaseId(input.contractId);
    id(input.deviceId);
    timestamp(input.expiresAt);
    if (!Number.isSafeInteger(input.targetPort) || input.targetPort < 1024 || input.targetPort > 65535) throw new AccessGatewayClientError("ACCESS_GATEWAY_TARGET_INVALID", "Host Agent 本地 SSH 端口无效。 ", 500);
    const payload = object(await this.request("/v1/leases", { method: "POST", body: JSON.stringify({ leaseId, deviceId: input.deviceId, contractId: input.contractId, expiresAt: input.expiresAt }) }, [200, 201]));
    exactKeys(payload, ["version", "leaseId", "deviceId", "contractId", "expiresAt", "buyerEndpoint", "buyerAccess", "agentTunnel"]);
    if (payload.version !== 1) throw new AccessGatewayClientError("ACCESS_GATEWAY_RESPONSE_INVALID", "KAI Access Gateway 协议版本无效。 ");
    const buyerAccess = object(payload.buyerAccess);
    exactKeys(buyerAccess, ["version", "leaseId", "token", "expiresAt"]);
    if (buyerAccess.version !== 1 || id(buyerAccess.leaseId, leaseId) !== leaseId || typeof buyerAccess.token !== "string" || !SECRET.test(buyerAccess.token)) {
      throw new AccessGatewayClientError("ACCESS_GATEWAY_RESPONSE_INVALID", "KAI Access Gateway 初始买家令牌无效。 ");
    }
    timestamp(buyerAccess.expiresAt);
    const agentTunnel = object(payload.agentTunnel);
    exactKeys(agentTunnel, ["host", "port", "ticket"]);
    const gatewayHost = typeof agentTunnel.host === "string" && HOST.test(agentTunnel.host.toLowerCase()) ? agentTunnel.host.toLowerCase() : "";
    const gatewayPort = Number(agentTunnel.port);
    const ticket = typeof agentTunnel.ticket === "string" && SECRET.test(agentTunnel.ticket) ? agentTunnel.ticket : "";
    if (!gatewayHost || !Number.isSafeInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535 || !ticket) throw new AccessGatewayClientError("ACCESS_GATEWAY_RESPONSE_INVALID", "KAI Access Gateway Agent 通道无效。 ");
    const expiresAt = timestamp(payload.expiresAt);
    const result = {
      leaseId: id(payload.leaseId, leaseId), contractId: id(payload.contractId, input.contractId), deviceId: id(payload.deviceId, input.deviceId),
      expiresAt, buyerEndpoint: endpoint(payload.buyerEndpoint),
      agentBundle: { version: 1 as const, gatewayHost, gatewayPort, serverName: gatewayHost, leaseId, ticket, targetPort: input.targetPort, expiresAt },
    };
    this.log("access_gateway.lease_ready", { contractId: input.contractId, deviceId: input.deviceId, leaseId });
    return result;
  }

  async issueBuyerAccess(contractId: string): Promise<AccessGatewayBuyerAccess> {
    const leaseId = accessGatewayLeaseId(contractId);
    const payload = object(await this.request(`/v1/leases/${encodeURIComponent(leaseId)}/buyer-tokens`, { method: "POST", body: "{}" }, [200, 201]));
    exactKeys(payload, ["version", "leaseId", "token", "expiresAt", "buyerEndpoint"]);
    const token = typeof payload.token === "string" && SECRET.test(payload.token) ? payload.token : "";
    if (payload.version !== 1 || !token) throw new AccessGatewayClientError("ACCESS_GATEWAY_RESPONSE_INVALID", "KAI Access Gateway 买家令牌无效。 ");
    return { leaseId: id(payload.leaseId, leaseId), buyerEndpoint: endpoint(payload.buyerEndpoint), token, expiresAt: timestamp(payload.expiresAt) };
  }

  async leaseStatus(contractId: string): Promise<AccessGatewayLeaseStatus> {
    const leaseId = accessGatewayLeaseId(contractId);
    const payload = object(await this.request(`/v1/leases/${encodeURIComponent(leaseId)}/status`, { method: "GET" }, [200]));
    exactKeys(payload, ["version", "leaseId", "status", "authenticatedAgentSlots", "activeConnections", "expiresAt"]);
    const status = payload.status;
    const authenticatedAgentSlots = Number(payload.authenticatedAgentSlots);
    const activeConnections = Number(payload.activeConnections);
    if (payload.version !== 1 || !["ACTIVE", "REVOKED", "EXPIRED"].includes(String(status))
      || !Number.isSafeInteger(authenticatedAgentSlots) || authenticatedAgentSlots < 0 || authenticatedAgentSlots > 1_024
      || !Number.isSafeInteger(activeConnections) || activeConnections < 0 || activeConnections > 1_024) {
      throw new AccessGatewayClientError("ACCESS_GATEWAY_RESPONSE_INVALID", "KAI Access Gateway 槽位状态响应无效。 ");
    }
    return { leaseId: id(payload.leaseId, leaseId), status: status as AccessGatewayLeaseStatus["status"], authenticatedAgentSlots, activeConnections, expiresAt: timestamp(payload.expiresAt) };
  }

  async revokeLease(contractId: string, reason: string): Promise<void> {
    const leaseId = accessGatewayLeaseId(contractId);
    const response = await this.request(`/v1/leases/${encodeURIComponent(leaseId)}`, { method: "DELETE", body: JSON.stringify({ reason: reason.slice(0, 80) }) }, [200, 404]);
    if (object(response).error && object(object(response).error).code !== "LEASE_NOT_FOUND") throw new AccessGatewayClientError("ACCESS_GATEWAY_RESPONSE_INVALID", "KAI Access Gateway 撤权响应无效。 ");
    this.log("access_gateway.lease_revoked_or_absent", { contractId, leaseId });
  }
}

export function getAccessGatewayClient() { return new AccessGatewayClient(); }
