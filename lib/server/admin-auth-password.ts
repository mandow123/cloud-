import { AccountAuthError, accountAuthDigest, createAccountSession } from "./account-auth.ts";
import { getAccountAuthStore, type AccountAuthStore } from "./account-auth-store.ts";

type Env = Record<string, string | undefined>;

const PBKDF2_ITERATIONS = 310_000;
const DUMMY_HASH = "pbkdf2-sha256:310000:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function runtimeEnv(): Env {
  return typeof process === "undefined" ? {} : process.env;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function normalizeUsername(value: unknown) {
  if (typeof value !== "string") throw new AccountAuthError("ADMIN_PASSWORD_INVALID", 401, "账号或密码错误。 ");
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(username)) throw new AccountAuthError("ADMIN_PASSWORD_INVALID", 401, "账号或密码错误。 ");
  return username;
}

function passwordValue(value: unknown) {
  if (typeof value !== "string" || value.length < 12 || value.length > 256) {
    throw new AccountAuthError("ADMIN_PASSWORD_INVALID", 401, "账号或密码错误。 ");
  }
  return value;
}

async function passwordMatches(password: string, encoded: string) {
  const [algorithm, rawIterations, saltValue, digestValue] = encoded.split(":");
  const iterations = Number(rawIterations);
  if (algorithm !== "pbkdf2-sha256" || iterations < PBKDF2_ITERATIONS || iterations > 1_000_000 || !saltValue || !digestValue) return false;
  let salt: Uint8Array<ArrayBuffer>;
  let expected: Uint8Array<ArrayBuffer>;
  try {
    salt = decodeBase64(saltValue);
    expected = decodeBase64(digestValue);
  } catch {
    return false;
  }
  if (salt.byteLength < 16 || expected.byteLength !== 32) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index]! ^ actual[index]!;
  return difference === 0;
}

async function requestFingerprint(request: Request) {
  const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return accountAuthDigest(`${address}:${request.headers.get("user-agent") ?? "unknown"}`);
}

export async function createAdminPasswordSession(
  request: Request,
  input: { username: unknown; password: unknown },
  options: { store?: AccountAuthStore; env?: Env; now?: Date } = {},
) {
  const env = options.env ?? runtimeEnv();
  const store = options.store ?? await getAccountAuthStore();
  const now = options.now ?? new Date();
  const username = normalizeUsername(input.username);
  const password = passwordValue(input.password);
  const configuredUsername = env.KAI_ADMIN_USERNAME?.trim().toLowerCase() ?? "";
  const configuredHash = env.KAI_ADMIN_PASSWORD_HASH?.trim() || DUMMY_HASH;
  const usernameHash = await accountAuthDigest(username);
  const fingerprint = await requestFingerprint(request);
  const since = new Date(now.getTime() - 15 * 60_000).toISOString();
  if (await store.countRecentPasswordFailures(usernameHash, fingerprint, since) >= 5) {
    throw new AccountAuthError("ADMIN_PASSWORD_RATE_LIMITED", 429, "登录尝试过多，请 15 分钟后重试。 ");
  }
  const matches = await passwordMatches(password, configuredHash);
  if (!configuredUsername || username !== configuredUsername || !matches) {
    await store.recordPasswordAttempt({ usernameHash, requestFingerprint: fingerprint, outcome: "DENIED", occurredAt: now.toISOString() });
    throw new AccountAuthError("ADMIN_PASSWORD_INVALID", 401, "账号或密码错误。 ");
  }

  const identity = await store.resolveOrCreatePasswordAdministrator({
    username,
    displayName: env.KAI_ADMIN_DISPLAY_NAME?.trim() || "KAI Cloud Root",
    createdAt: now.toISOString(),
  });
  try {
    await store.activateMembership(identity.membership.id, ["ROOT"], now.toISOString());
  } catch {
    throw new AccountAuthError("ADMIN_ROOT_CONFLICT", 409, "系统已经绑定了另一位 Root，不能创建第二个管理员。 ");
  }
  const active = await store.resolveOrCreatePasswordAdministrator({ username, displayName: identity.account.displayName, createdAt: now.toISOString() });
  await store.recordPasswordAttempt({ usernameHash, requestFingerprint: fingerprint, outcome: "ALLOWED", occurredAt: now.toISOString() });
  return createAccountSession(request, active, "ADMIN_PASSWORD", { store, now });
}
