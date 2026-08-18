import { AccountAuthError } from "./account-auth.ts";

function decodeKey(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) throw new AccountAuthError("SSH_PUBLIC_KEY_INVALID", 400, "SSH 公钥编码无效。 ");
  let binary: string;
  try { binary = atob(value); } catch { throw new AccountAuthError("SSH_PUBLIC_KEY_INVALID", 400, "SSH 公钥编码无效。 "); }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length < 32 || bytes.length > 8_192) throw new AccountAuthError("SSH_PUBLIC_KEY_INVALID", 400, "SSH 公钥长度无效。 ");
  return bytes;
}

function sshField(bytes: Uint8Array, offset: number) {
  if (offset + 4 > bytes.length) throw new AccountAuthError("SSH_PUBLIC_KEY_INVALID", 400, "SSH 公钥结构不完整。 ");
  const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
  const start = offset + 4;
  const end = start + length;
  if (length > 8_192 || end > bytes.length) throw new AccountAuthError("SSH_PUBLIC_KEY_INVALID", 400, "SSH 公钥结构不完整。 ");
  return { value: bytes.subarray(start, end), offset: end };
}

function validateOpenSshBlob(type: string, bytes: Uint8Array) {
  const algorithm = sshField(bytes, 0);
  if (new TextDecoder("utf-8", { fatal: true }).decode(algorithm.value) !== type) throw new AccountAuthError("SSH_PUBLIC_KEY_INVALID", 400, "SSH 公钥算法标记不一致。 ");
  if (type === "ssh-ed25519") {
    const key = sshField(bytes, algorithm.offset);
    if (key.value.length !== 32 || key.offset !== bytes.length) throw new AccountAuthError("SSH_PUBLIC_KEY_INVALID", 400, "Ed25519 SSH 公钥结构无效。 ");
    return;
  }
  const exponent = sshField(bytes, algorithm.offset);
  const modulus = sshField(bytes, exponent.offset);
  const significantBytes = modulus.value[0] === 0 ? modulus.value.length - 1 : modulus.value.length;
  if (exponent.value.length < 1 || exponent.value.length > 8 || significantBytes < 256 || modulus.offset !== bytes.length) throw new AccountAuthError("SSH_PUBLIC_KEY_INVALID", 400, "RSA SSH 公钥必须至少为 2048 位。 ");
}

export async function normalizeSshPublicKey(value: unknown) {
  if (typeof value !== "string" || value.includes("\r") || value.includes("\n")) throw new AccountAuthError("SSH_PUBLIC_KEY_INVALID", 400, "请提交单行 OpenSSH 公钥。 ");
  const normalized = value.normalize("NFKC").trim().replaceAll(/\s+/gu, " ");
  const [type, encoded, ...commentParts] = normalized.split(" ");
  if (type !== "ssh-ed25519" && type !== "ssh-rsa") throw new AccountAuthError("SSH_PUBLIC_KEY_INVALID", 400, "仅支持 Ed25519 或 RSA OpenSSH 公钥。 ");
  if (!encoded) throw new AccountAuthError("SSH_PUBLIC_KEY_INVALID", 400, "SSH 公钥内容缺失。 ");
  const comment = commentParts.join(" ");
  if (comment.length > 120) throw new AccountAuthError("SSH_PUBLIC_KEY_INVALID", 400, "SSH 公钥备注不能超过 120 个字符。 ");
  const bytes = decodeKey(encoded);
  try { validateOpenSshBlob(type, bytes); }
  catch (error) {
    if (error instanceof AccountAuthError) throw error;
    throw new AccountAuthError("SSH_PUBLIC_KEY_INVALID", 400, "SSH 公钥结构无效。 ");
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const fingerprint = `SHA256:${btoa(String.fromCharCode(...digest)).replaceAll("=", "")}`;
  return { publicKey: [type, encoded, comment || null].filter(Boolean).join(" "), fingerprint };
}
