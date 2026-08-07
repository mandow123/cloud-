export type SshDeliveryStatus =
  | "AWAITING_PAYMENT"
  | "AWAITING_KEY"
  | "PROVISIONING"
  | "READY"
  | "IN_SERVICE"
  | "CLEANING"
  | "COMPLETED"
  | "FAILED";

export type SshPublicKeyReceipt = {
  algorithm: string;
  fingerprint: string;
  submittedAt: string;
};

export class SshDeliveryError extends Error {
  readonly code: "SSH_PUBLIC_KEY_INVALID" | "SSH_TRANSITION_INVALID" | "SSH_DELIVERY_REFERENCE_INVALID";

  constructor(
    code: "SSH_PUBLIC_KEY_INVALID" | "SSH_TRANSITION_INVALID" | "SSH_DELIVERY_REFERENCE_INVALID",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "SshDeliveryError";
  }
}

const ALLOWED_TRANSITIONS: Readonly<Record<SshDeliveryStatus, readonly SshDeliveryStatus[]>> = {
  AWAITING_PAYMENT: ["AWAITING_KEY", "FAILED"],
  AWAITING_KEY: ["PROVISIONING", "FAILED"],
  PROVISIONING: ["READY", "FAILED"],
  READY: ["IN_SERVICE", "FAILED"],
  IN_SERVICE: ["CLEANING", "FAILED"],
  CLEANING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

function decodeBase64(value: string) {
  try {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    throw new SshDeliveryError("SSH_PUBLIC_KEY_INVALID", "SSH 公钥不是有效的 Base64 内容。");
  }
}

function base64WithoutPadding(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/u, "");
}

export async function inspectSshPublicKey(value: unknown): Promise<SshPublicKeyReceipt> {
  if (typeof value !== "string" || value.length < 32 || value.length > 16_384 || /[\r\n]/u.test(value)) {
    throw new SshDeliveryError("SSH_PUBLIC_KEY_INVALID", "请提交一行有效的 SSH 公钥，不能提交私钥或多行内容。");
  }
  if (value.includes("PRIVATE KEY")) {
    throw new SshDeliveryError("SSH_PUBLIC_KEY_INVALID", "禁止提交 SSH 私钥。");
  }
  const [algorithm, encoded] = value.trim().split(/\s+/u);
  if (![
    "ssh-ed25519",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "rsa-sha2-512",
    "rsa-sha2-256",
    "sk-ssh-ed25519@openssh.com",
  ].includes(algorithm) || !encoded) {
    throw new SshDeliveryError("SSH_PUBLIC_KEY_INVALID", "仅接受受支持的 OpenSSH 公钥格式。");
  }
  const keyBytes = decodeBase64(encoded);
  if (keyBytes.byteLength < 24 || keyBytes.byteLength > 8_192) {
    throw new SshDeliveryError("SSH_PUBLIC_KEY_INVALID", "SSH 公钥长度无效。");
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", keyBytes));
  return {
    algorithm,
    fingerprint: `SHA256:${base64WithoutPadding(digest)}`,
    submittedAt: new Date().toISOString(),
  };
}

export function assertSshDeliveryTransition(from: SshDeliveryStatus, to: SshDeliveryStatus) {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new SshDeliveryError("SSH_TRANSITION_INVALID", `SSH 交付状态不能从 ${from} 变更为 ${to}。`);
  }
}

export function validateSecureDeliveryReference(value: unknown, field: "endpoint" | "hostKey" | "cleanup") {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/u.test(value)) {
    throw new SshDeliveryError("SSH_DELIVERY_REFERENCE_INVALID", `${field} 证据引用格式无效。`);
  }
  if (/^(?:ssh|https?):\/\//iu.test(value) || /@/u.test(value)) {
    throw new SshDeliveryError(
      "SSH_DELIVERY_REFERENCE_INVALID",
      "这里只能保存密钥库或证据库引用，不能写入真实地址、用户名或凭据。",
    );
  }
  return value;
}

export function sshCredentialExpiry(serviceEndAt: string) {
  const serviceEnd = new Date(serviceEndAt);
  if (Number.isNaN(serviceEnd.getTime())) {
    throw new SshDeliveryError("SSH_DELIVERY_REFERENCE_INVALID", "服务结束时间无效。");
  }
  return new Date(serviceEnd.getTime() + 10 * 60_000).toISOString();
}
