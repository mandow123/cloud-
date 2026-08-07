import { inspectSshPublicKey, validateSecureDeliveryReference } from "./ssh-live.ts";

type ProvisionerEnvironment = Record<string, string | undefined>;

export class SshProvisionerError extends Error {
  readonly code: "SSH_PROVISIONER_NOT_CONFIGURED" | "SSH_PROVISIONER_REJECTED" | "SSH_PROVISIONER_INVALID_RESPONSE";

  constructor(code: SshProvisionerError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "SshProvisionerError";
  }
}

function runtimeEnvironment(): ProvisionerEnvironment {
  return typeof process === "undefined" ? {} : process.env;
}

export function sshProvisionerReadiness(environment: ProvisionerEnvironment = runtimeEnvironment()) {
  const missing = ["KAI_SSH_PROVISIONER_URL", "KAI_SSH_PROVISIONER_TOKEN"].filter((key) => !environment[key]?.trim());
  if ((environment.KAI_SSH_PROVISIONER_TOKEN?.trim().length ?? 0) > 0
    && (environment.KAI_SSH_PROVISIONER_TOKEN?.trim().length ?? 0) < 32) {
    missing.push("KAI_SSH_PROVISIONER_TOKEN(至少32位)");
  }
  return { configured: missing.length === 0, missing };
}

function provisionerConfig(environment: ProvisionerEnvironment = runtimeEnvironment()) {
  const readiness = sshProvisionerReadiness(environment);
  if (!readiness.configured) {
    throw new SshProvisionerError("SSH_PROVISIONER_NOT_CONFIGURED", `SSH 交付代理尚未配置：${readiness.missing.join(", ")}`);
  }
  const url = new URL(environment.KAI_SSH_PROVISIONER_URL!);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new SshProvisionerError("SSH_PROVISIONER_NOT_CONFIGURED", "SSH 交付代理必须使用 HTTPS 或本机回环地址。");
  }
  return { baseUrl: url, token: environment.KAI_SSH_PROVISIONER_TOKEN! };
}

async function provisionerRequest<T>(
  path: string,
  body: Record<string, unknown>,
  environment: ProvisionerEnvironment = runtimeEnvironment(),
): Promise<T> {
  const { baseUrl, token } = provisionerConfig(environment);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new SshProvisionerError("SSH_PROVISIONER_REJECTED", `SSH 交付代理拒绝请求（${response.status}）。`);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof SshProvisionerError) throw error;
    throw new SshProvisionerError("SSH_PROVISIONER_REJECTED", error instanceof Error ? error.message : "SSH 交付代理请求失败。");
  } finally {
    clearTimeout(timeout);
  }
}

function fingerprint(value: unknown, field: string) {
  if (typeof value !== "string" || !/^SHA256:[A-Za-z0-9+/]{20,64}$/u.test(value)) {
    throw new SshProvisionerError("SSH_PROVISIONER_INVALID_RESPONSE", `${field} 指纹格式无效。`);
  }
  return value;
}

function evidenceDigest(value: unknown) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/iu.test(value)) {
    throw new SshProvisionerError("SSH_PROVISIONER_INVALID_RESPONSE", "交付证据摘要格式无效。");
  }
  return value;
}

export async function registerSshPublicKey(input: {
  orderId: string;
  publicKey: string;
  serviceEndAt: string;
}, environment?: ProvisionerEnvironment) {
  const receipt = await inspectSshPublicKey(input.publicKey);
  const response = await provisionerRequest<{
    secureEndpointRef?: unknown;
    hostKeyFingerprint?: unknown;
    credentialExpiresAt?: unknown;
    evidenceDigest?: unknown;
  }>(`/v1/orders/${encodeURIComponent(input.orderId)}/authorized-keys`, {
    publicKey: input.publicKey,
    publicKeyFingerprint: receipt.fingerprint,
    serviceEndAt: input.serviceEndAt,
  }, environment);
  if (typeof response.credentialExpiresAt !== "string" || Number.isNaN(Date.parse(response.credentialExpiresAt))) {
    throw new SshProvisionerError("SSH_PROVISIONER_INVALID_RESPONSE", "凭据失效时间无效。");
  }
  const secureEndpointRef = validateSecureDeliveryReference(response.secureEndpointRef, "endpoint");
  if (!secureEndpointRef.startsWith("secure-ref:")) {
    throw new SshProvisionerError("SSH_PROVISIONER_INVALID_RESPONSE", "交付代理必须返回 secure-ref: 安全引用。");
  }
  return {
    publicKeyFingerprint: receipt.fingerprint,
    secureEndpointRef,
    hostKeyFingerprint: fingerprint(response.hostKeyFingerprint, "主机密钥"),
    credentialExpiresAt: response.credentialExpiresAt,
    evidenceDigest: evidenceDigest(response.evidenceDigest),
  };
}

export async function runSshConnectionCheck(orderId: string, environment?: ProvisionerEnvironment) {
  const response = await provisionerRequest<{
    status?: unknown;
    diagnosticCode?: unknown;
    evidenceDigest?: unknown;
    startedAt?: unknown;
    finishedAt?: unknown;
  }>(`/v1/orders/${encodeURIComponent(orderId)}/connection-checks`, {}, environment);
  if (response.status !== "PASSED" && response.status !== "FAILED") {
    throw new SshProvisionerError("SSH_PROVISIONER_INVALID_RESPONSE", "连接检查状态无效。");
  }
  if (typeof response.diagnosticCode !== "string" || !/^[A-Z0-9_:-]{3,100}$/u.test(response.diagnosticCode)) {
    throw new SshProvisionerError("SSH_PROVISIONER_INVALID_RESPONSE", "连接检查诊断码无效。");
  }
  if (typeof response.startedAt !== "string" || typeof response.finishedAt !== "string"
    || Number.isNaN(Date.parse(response.startedAt)) || Number.isNaN(Date.parse(response.finishedAt))) {
    throw new SshProvisionerError("SSH_PROVISIONER_INVALID_RESPONSE", "连接检查时间无效。");
  }
  return {
    status: response.status as "PASSED" | "FAILED",
    diagnosticCode: response.diagnosticCode,
    evidenceDigest: evidenceDigest(response.evidenceDigest),
    startedAt: response.startedAt,
    finishedAt: response.finishedAt,
  };
}

export async function startSshService(orderId: string, environment?: ProvisionerEnvironment) {
  const response = await provisionerRequest<{ evidenceDigest?: unknown }>(`/v1/orders/${encodeURIComponent(orderId)}/service-start`, {}, environment);
  return { evidenceDigest: evidenceDigest(response.evidenceDigest) };
}

export async function stopSshService(orderId: string, environment?: ProvisionerEnvironment) {
  const response = await provisionerRequest<{ evidenceDigest?: unknown }>(`/v1/orders/${encodeURIComponent(orderId)}/service-stop`, {}, environment);
  return { evidenceDigest: evidenceDigest(response.evidenceDigest) };
}

export async function cleanSshService(orderId: string, environment?: ProvisionerEnvironment) {
  const response = await provisionerRequest<{ evidenceDigest?: unknown }>(`/v1/orders/${encodeURIComponent(orderId)}/cleanup`, {}, environment);
  return { evidenceDigest: evidenceDigest(response.evidenceDigest) };
}
