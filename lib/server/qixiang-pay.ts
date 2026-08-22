import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const QIXIANG_PAY_REQUIRED_ENV = [
  "KAI_QIXIANG_PAY_PID",
  "KAI_QIXIANG_PAY_KEY",
  "KAI_QIXIANG_PAY_APPROVAL_REFERENCE",
  "KAI_QIXIANG_PAY_PILOT_ORGANIZATIONS",
  "KAI_QIXIANG_PAY_PILOT_CHANNEL",
  "KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE",
  "KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID",
  "KAI_PUBLIC_ORIGIN",
] as const;

const QIXIANG_PAY_APPROVAL_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/u;
const QIXIANG_PAY_CREDENTIAL_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/u;
const QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE_PATTERN = /^RISK-[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$/u;
const QIXIANG_PAY_QUERY_CREDENTIAL_ID_PATTERN = /^QRY-[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/u;
const QIXIANG_PAY_PLACEHOLDER_SECRET_PATTERN = /(?:change[-_ ]?me|dummy|example|insert|placeholder|replace|secret[-_ ]?here|test[-_ ]?secret|your[-_ ])/iu;
const QIXIANG_PAY_REVOKED_KEY_DIGESTS = new Set(["4d81683f5583c963560a31d39b8fcadfd7fa686b97519e26d9feaa6b7d523956"]);
const QIXIANG_PAY_QUERY_WINDOW_MS = 60_000;
const QIXIANG_PAY_QUERY_MAX_REQUESTS_PER_WINDOW = 12;
const QIXIANG_PAY_QUERY_CIRCUIT_FAILURE_THRESHOLD = 3;
const QIXIANG_PAY_QUERY_CIRCUIT_OPEN_MS = 60_000;

type QixiangQueryProtectionState = {
  windowStartedAt: number;
  requestCount: number;
  consecutiveFailures: number;
  circuitOpenUntil: number;
};

declare global {
  var __kaiQixiangQueryProtection: Map<string, QixiangQueryProtectionState> | undefined;
}

export type QixiangPayEnvironment = Record<string, string | undefined>;
export type QixiangPaymentType = "alipay" | "wxpay";
export type QixiangPaymentChannel = "ALIPAY" | "WXPAY";
export type QixiangVerifiedPayment = Readonly<{
  provider: "QIXIANG_PAY";
  providerEventId: string;
  providerTransactionId: string;
  providerOrderId: string;
  merchantAccountRef: string;
  paymentType: QixiangPaymentType;
  productName: string | null;
  merchantParam: string | null;
  eventType: "CAPTURED";
  amountCents: number;
  currency: "CNY";
  occurredAt: string;
  rawPayloadDigest: string;
  verificationMethod: "QIXIANG_ORDER_QUERY" | "QIXIANG_MD5_NOTIFY_AND_ORDER_QUERY";
  verifiedAt: string;
  fundsMoved: true;
}>;

export type QixiangSignedPaymentNotification = Readonly<{
  provider: "QIXIANG_PAY";
  providerEventId: string;
  providerTransactionId: string;
  providerOrderId: string;
  merchantAccountRef: string;
  paymentType: QixiangPaymentType;
  productName: string | null;
  merchantParam: string | null;
  tradeStatus: "TRADE_SUCCESS";
  amountCents: number;
  currency: "CNY";
  receivedAt: string;
  rawPayloadDigest: string;
  verificationMethod: "QIXIANG_MD5_NOTIFY";
}>;

export type QixiangExpectedPayment = Readonly<{
  orderId: string;
  amountCents: number;
  subject: string;
  paymentType: QixiangPaymentType;
  merchantParam: string;
}>;

export class QixiangPayError extends Error {
  readonly code: "QIXIANG_PAY_NOT_CONFIGURED" | "QIXIANG_PAY_INVALID_ORDER" | "QIXIANG_PAY_SIGNATURE_INVALID" | "QIXIANG_PAY_NOTIFICATION_INVALID" | "QIXIANG_PAY_MERCHANT_MISMATCH" | "QIXIANG_PAY_OUTCOME_UNKNOWN";
  constructor(code: QixiangPayError["code"], message: string) { super(message); this.name = "QixiangPayError"; this.code = code; }
}

function runtimeEnvironment(): QixiangPayEnvironment { return typeof process === "undefined" ? {} : process.env; }
function paymentChannels(environment: QixiangPayEnvironment) {
  const values = (environment.KAI_QIXIANG_PAY_CHANNELS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length < 1 || values.some((value) => value !== "ALIPAY" && value !== "WXPAY") || new Set(values).size !== values.length) return [];
  return values as QixiangPaymentChannel[];
}
function pilotOrganizations(environment: QixiangPayEnvironment) {
  const values = (environment.KAI_QIXIANG_PAY_PILOT_ORGANIZATIONS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length < 1 || values.length > 20 || values.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u.test(value)) || new Set(values).size !== values.length) return [];
  return values;
}
function pilotChannel(environment: QixiangPayEnvironment) {
  const value = environment.KAI_QIXIANG_PAY_PILOT_CHANNEL?.trim();
  return value === "ALIPAY" || value === "WXPAY" ? value : null;
}
const typeForChannel = (channel: QixiangPaymentChannel): QixiangPaymentType => channel === "ALIPAY" ? "alipay" : "wxpay";
function endpoint(value: string | undefined, fallback: string, expectedOrigin: string, expectedPath: string) {
  try {
    const url = new URL(value?.trim() || fallback);
    if (url.origin !== expectedOrigin || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== expectedPath) return null;
    return url;
  } catch { return null; }
}
function publicOrigin(value: string | undefined) {
  try {
    const url = new URL(value?.trim() || "");
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

function validApprovalReference(value: string | undefined) {
  return QIXIANG_PAY_APPROVAL_REFERENCE_PATTERN.test(value?.trim() || "");
}

function validCredentialRotation(value: string | undefined) {
  const text = value?.trim() || "";
  const timestamp = Date.parse(text);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(text)
    && Number.isFinite(timestamp)
    && timestamp >= Date.parse("2020-01-01T00:00:00.000Z")
    && timestamp <= Date.now() + 5 * 60 * 1000;
}

function validCredentialLifecycle(environment: QixiangPayEnvironment, rotatedAtName: string, versionName: string) {
  return validCredentialRotation(environment[rotatedAtName])
    || QIXIANG_PAY_CREDENTIAL_VERSION_PATTERN.test(environment[versionName]?.trim() || "");
}

function validMerchantKey(value: string | undefined) {
  const key = value?.trim() || "";
  return value === key
    && Buffer.byteLength(key, "utf8") >= 16
    && !QIXIANG_PAY_PLACEHOLDER_SECRET_PATTERN.test(key)
    && !QIXIANG_PAY_REVOKED_KEY_DIGESTS.has(createHash("sha256").update(key).digest("hex"));
}

export function qixiangPayReadiness(environment: QixiangPayEnvironment = runtimeEnvironment()) {
  const missing: string[] = QIXIANG_PAY_REQUIRED_ENV.filter((name) => !environment[name]?.trim());
  if (!/^\d{1,18}$/u.test(environment.KAI_QIXIANG_PAY_PID?.trim() || "")) missing.push("KAI_QIXIANG_PAY_PID(valid)");
  if (!validMerchantKey(environment.KAI_QIXIANG_PAY_KEY)) missing.push("KAI_QIXIANG_PAY_KEY(valid secret)");
  if (!validApprovalReference(environment.KAI_QIXIANG_PAY_APPROVAL_REFERENCE)) missing.push("KAI_QIXIANG_PAY_APPROVAL_REFERENCE(valid)");
  if (!validCredentialLifecycle(environment, "KAI_QIXIANG_PAY_CREDENTIAL_ROTATED_AT", "KAI_QIXIANG_PAY_CREDENTIAL_VERSION")) missing.push("KAI_QIXIANG_PAY_CREDENTIAL_ROTATED_AT_OR_VERSION(valid)");
  if (environment.KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_ACCEPTED?.trim() !== "1") missing.push("KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_ACCEPTED(explicit)");
  if (!QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE_PATTERN.test(environment.KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE?.trim() || "")) missing.push("KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE(valid)");
  if (!QIXIANG_PAY_QUERY_CREDENTIAL_ID_PATTERN.test(environment.KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID?.trim() || "")) missing.push("KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID(valid)");
  if (!validCredentialLifecycle(environment, "KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ROTATED_AT", "KAI_QIXIANG_PAY_QUERY_CREDENTIAL_VERSION")) missing.push("KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ROTATED_AT_OR_VERSION(valid)");
  if (paymentChannels(environment).length < 1) missing.push("KAI_QIXIANG_PAY_CHANNELS(valid)");
  const selectedPilotChannel = pilotChannel(environment);
  if (pilotOrganizations(environment).length < 1) missing.push("KAI_QIXIANG_PAY_PILOT_ORGANIZATIONS(valid)");
  if (!selectedPilotChannel || paymentChannels(environment).length !== 1 || !paymentChannels(environment).includes(selectedPilotChannel)) missing.push("KAI_QIXIANG_PAY_PILOT_CHANNEL(single configured channel)");
  if (!endpoint(environment.KAI_QIXIANG_PAY_GATEWAY, "https://api.payqixiang.cn/mapi.php", "https://api.payqixiang.cn", "/mapi.php")) missing.push("KAI_QIXIANG_PAY_GATEWAY(approved HTTPS endpoint)");
  if (!endpoint(environment.KAI_QIXIANG_PAY_QUERY_ENDPOINT, "https://api.payqixiang.cn/api.php", "https://api.payqixiang.cn", "/api.php")) missing.push("KAI_QIXIANG_PAY_QUERY_ENDPOINT(approved HTTPS endpoint)");
  if (!publicOrigin(environment.KAI_PUBLIC_ORIGIN)) missing.push("KAI_PUBLIC_ORIGIN(valid HTTPS origin)");
  const reconciliation = qixiangPayReconciliationReadiness(environment);
  if (!reconciliation.configured) missing.push(...reconciliation.missing);
  const uniqueMissing = [...new Set(missing)];
  const enabled = environment.KAI_QIXIANG_PAY_ENABLED?.trim() === "1";
  return {
    enabled,
    configured: uniqueMissing.length === 0,
    canCreatePayment: enabled && reconciliation.canReconcilePayment && uniqueMissing.length === 0,
    reconciliationEnabled: reconciliation.enabled,
    canReconcilePayment: reconciliation.canReconcilePayment,
    missing: uniqueMissing,
    merchantAccountRef: environment.KAI_QIXIANG_PAY_PID?.trim() || null,
    channels: paymentChannels(environment),
    pilotChannel: selectedPilotChannel,
  } as const;
}

export function qixiangPayPilotAccess(organizationId: string, environment: QixiangPayEnvironment = runtimeEnvironment()) {
  const readiness = qixiangPayReadiness(environment);
  const allowed = pilotOrganizations(environment).includes(organizationId);
  return {
    ready: readiness.canCreatePayment && allowed && readiness.pilotChannel !== null,
    allowed,
    channel: readiness.pilotChannel,
    cardHours: 5,
    reason: !readiness.canCreatePayment
      ? "人民币充值渠道正在完成生产验收。"
      : allowed
        ? null
        : "当前账户尚未进入小额生产验收名单。",
  } as const;
}

export function qixiangPayCredentialReadiness(environment: QixiangPayEnvironment = runtimeEnvironment()) {
  const missing: string[] = [];
  if (!/^\d{1,18}$/u.test(environment.KAI_QIXIANG_PAY_PID?.trim() || "")) missing.push("KAI_QIXIANG_PAY_PID(valid)");
  if (!validMerchantKey(environment.KAI_QIXIANG_PAY_KEY)) missing.push("KAI_QIXIANG_PAY_KEY(valid secret)");
  return { configured: missing.length === 0, missing, merchantAccountRef: environment.KAI_QIXIANG_PAY_PID?.trim() || null } as const;
}

export function qixiangPayReconciliationReadiness(environment: QixiangPayEnvironment = runtimeEnvironment()) {
  const missing: string[] = [];
  if (!/^\d{1,18}$/u.test(environment.KAI_QIXIANG_PAY_PID?.trim() || "")) missing.push("KAI_QIXIANG_PAY_PID(valid)");
  if (!validMerchantKey(environment.KAI_QIXIANG_PAY_KEY)) missing.push("KAI_QIXIANG_PAY_KEY(valid secret)");
  if (!validApprovalReference(environment.KAI_QIXIANG_PAY_APPROVAL_REFERENCE)) missing.push("KAI_QIXIANG_PAY_APPROVAL_REFERENCE(valid)");
  if (environment.KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_ACCEPTED?.trim() !== "1") missing.push("KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_ACCEPTED(explicit)");
  if (!QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE_PATTERN.test(environment.KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE?.trim() || "")) missing.push("KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE(valid)");
  if (!QIXIANG_PAY_QUERY_CREDENTIAL_ID_PATTERN.test(environment.KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID?.trim() || "")) missing.push("KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID(valid)");
  if (!validCredentialLifecycle(environment, "KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ROTATED_AT", "KAI_QIXIANG_PAY_QUERY_CREDENTIAL_VERSION")) missing.push("KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ROTATED_AT_OR_VERSION(valid)");
  if (!endpoint(environment.KAI_QIXIANG_PAY_QUERY_ENDPOINT, "https://api.payqixiang.cn/api.php", "https://api.payqixiang.cn", "/api.php")) missing.push("KAI_QIXIANG_PAY_QUERY_ENDPOINT(approved HTTPS endpoint)");
  const enabled = environment.KAI_QIXIANG_PAY_RECONCILIATION_ENABLED?.trim() === "1";
  return { enabled, configured: missing.length === 0, canReconcilePayment: enabled && missing.length === 0, missing } as const;
}

function checkoutConfiguration(environment: QixiangPayEnvironment) {
  const readiness = qixiangPayReadiness(environment);
  if (!readiness.canCreatePayment) throw new QixiangPayError("QIXIANG_PAY_NOT_CONFIGURED", readiness.enabled ? "支付通道配置未完成。" : "支付通道当前保持关闭。");
  return {
    pid: environment.KAI_QIXIANG_PAY_PID!.trim(), key: environment.KAI_QIXIANG_PAY_KEY!.trim(),
    channels: readiness.channels, origin: publicOrigin(environment.KAI_PUBLIC_ORIGIN)!,
    gateway: endpoint(environment.KAI_QIXIANG_PAY_GATEWAY, "https://api.payqixiang.cn/mapi.php", "https://api.payqixiang.cn", "/mapi.php")!,
  };
}

function credentialConfiguration(environment: QixiangPayEnvironment) {
  const readiness = qixiangPayCredentialReadiness(environment);
  if (!readiness.configured) throw new QixiangPayError("QIXIANG_PAY_NOT_CONFIGURED", "支付通道回调验签配置未完成。");
  const orderQuery = endpoint(environment.KAI_QIXIANG_PAY_QUERY_ENDPOINT, "https://api.payqixiang.cn/api.php", "https://api.payqixiang.cn", "/api.php");
  if (!orderQuery) throw new QixiangPayError("QIXIANG_PAY_NOT_CONFIGURED", "支付通道查单地址配置无效。");
  return { pid: environment.KAI_QIXIANG_PAY_PID!.trim(), key: environment.KAI_QIXIANG_PAY_KEY!.trim(), orderQuery };
}

function activeOrderQueryConfiguration(environment: QixiangPayEnvironment) {
  const readiness = qixiangPayReconciliationReadiness(environment);
  if (!readiness.canReconcilePayment) {
    throw new QixiangPayError(
      "QIXIANG_PAY_NOT_CONFIGURED",
      readiness.enabled ? "支付核对配置未完成。" : "支付核对当前保持关闭，不执行主动查单。",
    );
  }
  return {
    ...credentialConfiguration(environment),
    credentialId: environment.KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID!.trim(),
  };
}

function queryProtectionState(credentialId: string, now: number) {
  const states = globalThis.__kaiQixiangQueryProtection ??= new Map();
  const current = states.get(credentialId);
  if (current) return current;
  const created = { windowStartedAt: now, requestCount: 0, consecutiveFailures: 0, circuitOpenUntil: 0 };
  states.set(credentialId, created);
  return created;
}

function consumeQueryBudget(credentialId: string, now = Date.now()) {
  const state = queryProtectionState(credentialId, now);
  if (state.circuitOpenUntil > now) throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付服务主动核对暂时熔断，请转人工核对。");
  if (now - state.windowStartedAt >= QIXIANG_PAY_QUERY_WINDOW_MS) {
    state.windowStartedAt = now;
    state.requestCount = 0;
  }
  if (state.requestCount >= QIXIANG_PAY_QUERY_MAX_REQUESTS_PER_WINDOW) throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付服务主动核对请求过于频繁，请转人工核对。");
  state.requestCount += 1;
}

function recordQueryTransportFailure(credentialId: string, now = Date.now()) {
  const state = queryProtectionState(credentialId, now);
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= QIXIANG_PAY_QUERY_CIRCUIT_FAILURE_THRESHOLD) {
    state.circuitOpenUntil = now + QIXIANG_PAY_QUERY_CIRCUIT_OPEN_MS;
  }
}

function recordQueryTransportSuccess(credentialId: string, now = Date.now()) {
  const state = queryProtectionState(credentialId, now);
  state.consecutiveFailures = 0;
  state.circuitOpenUntil = 0;
}

export function trustedQixiangClientIp(request: Request, environment: QixiangPayEnvironment = runtimeEnvironment()) {
  if (environment.KAI_TRUST_PROXY !== "1") throw new QixiangPayError("QIXIANG_PAY_INVALID_ORDER", "无法可信确认支付请求来源地址。");
  const forwarded = request.headers.get("x-forwarded-for")?.trim() ?? "";
  if (!forwarded || forwarded.includes(",") || isIP(forwarded) === 0) throw new QixiangPayError("QIXIANG_PAY_INVALID_ORDER", "支付请求来源地址无效。");
  return forwarded;
}

function canonicalParameters(parameters: Record<string, string>) {
  return Object.entries(parameters)
    .filter(([name, value]) => name !== "sign" && name !== "sign_type" && value !== "")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, value]) => `${name}=${value}`).join("&");
}

export function signQixiangParameters(parameters: Record<string, string>, merchantKey: string) {
  return createHash("md5").update(`${canonicalParameters(parameters)}${merchantKey}`, "utf8").digest("hex");
}

function signaturesEqual(received: string, expected: string) {
  if (!/^[a-f0-9]{32}$/u.test(received)) return false;
  return timingSafeEqual(Buffer.from(received, "ascii"), Buffer.from(expected, "ascii"));
}
function assertOrderId(value: string) {
  if (!/^KAI_CH_[A-Za-z0-9]{16,56}$/u.test(value)) throw new QixiangPayError("QIXIANG_PAY_INVALID_ORDER", "商户订单号格式无效。");
}
function amountText(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 100_000_000) throw new QixiangPayError("QIXIANG_PAY_INVALID_ORDER", "支付金额无效。");
  return `${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, "0")}`;
}
function parseAmountCents(value: unknown) {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^\d{1,9}(?:\.\d{1,2})?$/u.test(text)) throw new QixiangPayError("QIXIANG_PAY_NOTIFICATION_INVALID", "支付金额格式无效。");
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new QixiangPayError("QIXIANG_PAY_NOTIFICATION_INVALID", "支付金额超出范围。");
  return result;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function uniqueParameters(input: URLSearchParams) {
  const allowed = new Set(["pid", "trade_no", "out_trade_no", "type", "name", "money", "trade_status", "param", "sign", "sign_type"]);
  const output: Record<string, string> = {};
  for (const [name, value] of input) {
    if (Object.hasOwn(output, name)) throw new QixiangPayError("QIXIANG_PAY_NOTIFICATION_INVALID", "支付通知包含重复字段。");
    if (!allowed.has(name) || !/^[a-z_]+$/u.test(name) || value.length > 1024 || /[\u0000-\u001f\u007f]/u.test(value)) throw new QixiangPayError("QIXIANG_PAY_NOTIFICATION_INVALID", "支付通知字段无效。");
    output[name] = value;
  }
  return output;
}
async function readJson(response: Response) {
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付服务返回格式需要人工核对。");
  const text = await response.text();
  if (!response.ok || new TextEncoder().encode(text).byteLength > 32 * 1024) throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付服务请求结果需要人工核对。");
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return { value: value as Record<string, unknown>, raw: text };
  } catch { throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付服务请求结果需要人工核对。"); }
}

export type QixiangCheckoutOrder = Readonly<{ orderId: string; amountCents: number; subject: string; channel: QixiangPaymentChannel; clientIp: string; returnPath?: string }>;

function prepareQixiangPayCheckout(order: QixiangCheckoutOrder, environment: QixiangPayEnvironment) {
  const config = checkoutConfiguration(environment);
  assertOrderId(order.orderId);
  if (!config.channels.includes(order.channel)) throw new QixiangPayError("QIXIANG_PAY_INVALID_ORDER", "所选支付方式未开放。");
  const selectedType = typeForChannel(order.channel);
  const subject = order.subject.trim();
  if (!subject || new TextEncoder().encode(subject).byteLength > 127) throw new QixiangPayError("QIXIANG_PAY_INVALID_ORDER", "支付标题长度无效。");
  const returnPath = order.returnPath ?? "/member?topup=return";
  if (!returnPath.startsWith("/") || returnPath.startsWith("//")) throw new QixiangPayError("QIXIANG_PAY_INVALID_ORDER", "支付返回地址无效。");
  if (isIP(order.clientIp) === 0) throw new QixiangPayError("QIXIANG_PAY_INVALID_ORDER", "支付请求来源地址无效。");
  const parameters: Record<string, string> = {
    pid: config.pid, type: selectedType, out_trade_no: order.orderId,
    notify_url: `${config.origin}/api/v1/payments/qixiang-pay/notify`, return_url: `${config.origin}${returnPath}`,
    name: subject, money: amountText(order.amountCents), clientip: order.clientIp, device: "jump", param: order.orderId,
  };
  parameters.sign = signQixiangParameters(parameters, config.key);
  parameters.sign_type = "MD5";
  return { config, parameters, selectedType };
}

export function validateQixiangPayCheckout(order: QixiangCheckoutOrder, environment: QixiangPayEnvironment = runtimeEnvironment()) {
  const prepared = prepareQixiangPayCheckout(order, environment);
  return { provider: "QIXIANG_PAY" as const, channel: order.channel, paymentType: prepared.selectedType, amountCents: order.amountCents };
}

export async function createQixiangPayCheckout(order: QixiangCheckoutOrder, environment: QixiangPayEnvironment = runtimeEnvironment(), fetcher: typeof fetch = fetch) {
  const { config, parameters, selectedType } = prepareQixiangPayCheckout(order, environment);
  let response: Response;
  try {
    response = await fetcher(config.gateway, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", accept: "application/json" }, body: new URLSearchParams(parameters), redirect: "error", signal: AbortSignal.timeout(8_000) });
  } catch { throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付服务请求结果需要人工核对。"); }
  const { value } = await readJson(response);
  if (Number(value.code) !== 1 || typeof value.payurl !== "string") throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付服务请求结果需要人工核对。");
  let checkoutUrl: URL;
  try { checkoutUrl = new URL(value.payurl); } catch { throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付服务请求结果需要人工核对。"); }
  if (checkoutUrl.protocol !== "https:" || checkoutUrl.origin !== config.gateway.origin || checkoutUrl.username || checkoutUrl.password
    || !checkoutUrl.pathname.startsWith("/pay/submit/") || checkoutUrl.pathname.length > 512 || checkoutUrl.search || checkoutUrl.hash) {
    throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付服务请求结果需要人工核对。");
  }
  return { provider: "QIXIANG_PAY" as const, checkoutUrl: checkoutUrl.toString(), merchantAccountRef: config.pid, paymentType: selectedType, channel: order.channel, amountCents: order.amountCents, currency: "CNY" as const };
}

export async function verifyQixiangPayNotification(query: URLSearchParams, rawQuery: string, environment: QixiangPayEnvironment = runtimeEnvironment()): Promise<QixiangSignedPaymentNotification> {
  const config = credentialConfiguration(environment);
  const payload = uniqueParameters(query);
  if (payload.sign_type !== "MD5" || !signaturesEqual(payload.sign ?? "", signQixiangParameters(payload, config.key))) throw new QixiangPayError("QIXIANG_PAY_SIGNATURE_INVALID", "支付通知验签失败。");
  assertOrderId(payload.out_trade_no ?? "");
  if (payload.pid !== config.pid) throw new QixiangPayError("QIXIANG_PAY_MERCHANT_MISMATCH", "支付通知商户不匹配。");
  if ((payload.type !== "alipay" && payload.type !== "wxpay") || payload.trade_status !== "TRADE_SUCCESS") throw new QixiangPayError("QIXIANG_PAY_NOTIFICATION_INVALID", "支付通知状态或通道不匹配。");
  if (!/^[A-Za-z0-9_-]{8,96}$/u.test(payload.trade_no ?? "")) throw new QixiangPayError("QIXIANG_PAY_NOTIFICATION_INVALID", "支付平台订单号无效。");
  const now = new Date().toISOString();
  return { provider: "QIXIANG_PAY", providerEventId: `notify:${payload.trade_no}:TRADE_SUCCESS`, providerTransactionId: payload.trade_no, providerOrderId: payload.out_trade_no, merchantAccountRef: payload.pid, paymentType: payload.type, productName: payload.name || null, merchantParam: payload.param || null, tradeStatus: "TRADE_SUCCESS", amountCents: parseAmountCents(payload.money), currency: "CNY", receivedAt: now, rawPayloadDigest: await sha256(rawQuery), verificationMethod: "QIXIANG_MD5_NOTIFY" };
}

function requiredQueryText(payload: Record<string, unknown>, name: string, maxLength = 1024) {
  const value = payload[name];
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/u.test(text)) throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付服务查单结果需要人工核对。");
  return text;
}

function optionalQueryText(payload: Record<string, unknown>, name: string, maxLength = 1024) {
  const value = payload[name];
  if (value == null || value === "") return "";
  return requiredQueryText(payload, name, maxLength);
}

function validateExpectedPayment(expected: QixiangExpectedPayment) {
  assertOrderId(expected.orderId);
  const subject = expected.subject.trim();
  if (!subject || new TextEncoder().encode(subject).byteLength > 127) throw new QixiangPayError("QIXIANG_PAY_INVALID_ORDER", "支付标题长度无效。");
  if (expected.paymentType !== "alipay" && expected.paymentType !== "wxpay") throw new QixiangPayError("QIXIANG_PAY_INVALID_ORDER", "支付方式无效。");
  if (expected.merchantParam !== expected.orderId) throw new QixiangPayError("QIXIANG_PAY_INVALID_ORDER", "支付扩展参数无效。");
  return { ...expected, subject, amountText: amountText(expected.amountCents) } as const;
}

export async function queryQixiangPayOrder(expectedInput: QixiangExpectedPayment, environment: QixiangPayEnvironment = runtimeEnvironment(), fetcher: typeof fetch = fetch): Promise<QixiangVerifiedPayment> {
  const expected = validateExpectedPayment(expectedInput);
  const config = activeOrderQueryConfiguration(environment);
  consumeQueryBudget(config.credentialId);
  const queryUrl = new URL(config.orderQuery);
  queryUrl.search = new URLSearchParams({ act: "order", pid: config.pid, key: config.key, out_trade_no: expected.orderId }).toString();
  let response: Response;
  try {
    response = await fetcher(queryUrl, { method: "GET", headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(8_000) });
  } catch {
    recordQueryTransportFailure(config.credentialId);
    throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付服务查单结果需要人工核对。");
  }
  let payload: Awaited<ReturnType<typeof readJson>>;
  try {
    payload = await readJson(response);
    recordQueryTransportSuccess(config.credentialId);
  } catch (error) {
    recordQueryTransportFailure(config.credentialId);
    throw error;
  }
  const { value, raw } = payload;
  if (Number(value.code) !== 1 || Number(value.status) !== 1) throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付服务尚未确认订单已支付。");
  const tradeNo = requiredQueryText(value, "trade_no", 96);
  const orderId = requiredQueryText(value, "out_trade_no", 96);
  const pid = requiredQueryText(value, "pid", 18);
  const paymentType = requiredQueryText(value, "type", 16);
  const subject = requiredQueryText(value, "name", 127);
  const merchantParam = optionalQueryText(value, "param");
  const money = requiredQueryText(value, "money", 16);
  let amountCents: number;
  try { amountCents = parseAmountCents(money); }
  catch { throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付服务查单金额无效，需要人工核对。"); }
  if (!/^[A-Za-z0-9_-]{8,96}$/u.test(tradeNo)
    || orderId !== expected.orderId
    || pid !== config.pid
    || paymentType !== expected.paymentType
    || subject !== expected.subject
    || merchantParam !== expected.merchantParam
    || amountCents !== expected.amountCents
    || money !== expected.amountText) {
    throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付服务查单结果与付款单不一致，需要人工核对。");
  }
  const now = new Date().toISOString();
  return {
    provider: "QIXIANG_PAY", providerEventId: `query:${tradeNo}:TRADE_SUCCESS`, providerTransactionId: tradeNo,
    providerOrderId: orderId, merchantAccountRef: pid, paymentType: expected.paymentType, productName: subject,
    merchantParam, eventType: "CAPTURED", amountCents, currency: "CNY", occurredAt: now,
    rawPayloadDigest: await sha256(raw), verificationMethod: "QIXIANG_ORDER_QUERY", verifiedAt: now, fundsMoved: true,
  };
}

export async function confirmQixiangPayNotification(notification: QixiangSignedPaymentNotification, expected: QixiangExpectedPayment, environment: QixiangPayEnvironment = runtimeEnvironment(), fetcher: typeof fetch = fetch): Promise<QixiangVerifiedPayment> {
  const config = credentialConfiguration(environment);
  if (notification.providerOrderId !== expected.orderId
    || notification.merchantAccountRef !== config.pid
    || notification.paymentType !== expected.paymentType
    || notification.amountCents !== expected.amountCents
    || (notification.productName !== null && notification.productName !== expected.subject)
    || (notification.merchantParam !== null && notification.merchantParam !== expected.merchantParam)) {
    throw new QixiangPayError("QIXIANG_PAY_NOTIFICATION_INVALID", "支付通知与付款单不一致。");
  }
  const queried = await queryQixiangPayOrder(expected, environment, fetcher);
  if (queried.providerTransactionId !== notification.providerTransactionId) throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付通知与主动查单结果不一致，需要人工核对。");
  return {
    ...queried,
    providerEventId: notification.providerEventId,
    rawPayloadDigest: await sha256(`${notification.rawPayloadDigest}|${queried.rawPayloadDigest}`),
    verificationMethod: "QIXIANG_MD5_NOTIFY_AND_ORDER_QUERY",
  };
}
