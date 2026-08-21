import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const QIXIANG_PAY_REQUIRED_ENV = [
  "KAI_QIXIANG_PAY_PID",
  "KAI_QIXIANG_PAY_KEY",
  "KAI_PUBLIC_ORIGIN",
] as const;

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
  verificationMethod: "QIXIANG_MD5_NOTIFY";
  verifiedAt: string;
  fundsMoved: true;
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
const typeForChannel = (channel: QixiangPaymentChannel): QixiangPaymentType => channel === "ALIPAY" ? "alipay" : "wxpay";
function endpoint(value: string | undefined, fallback: string, expectedPath: string) {
  try {
    const url = new URL(value?.trim() || fallback);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== expectedPath) return null;
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

export function qixiangPayReadiness(environment: QixiangPayEnvironment = runtimeEnvironment()) {
  const missing: string[] = QIXIANG_PAY_REQUIRED_ENV.filter((name) => !environment[name]?.trim());
  if (!/^\d{1,18}$/u.test(environment.KAI_QIXIANG_PAY_PID?.trim() || "")) missing.push("KAI_QIXIANG_PAY_PID(valid)");
  if ((environment.KAI_QIXIANG_PAY_KEY?.trim().length ?? 0) < 16) missing.push("KAI_QIXIANG_PAY_KEY(>=16 chars)");
  if (paymentChannels(environment).length < 1) missing.push("KAI_QIXIANG_PAY_CHANNELS(valid)");
  if (!endpoint(environment.KAI_QIXIANG_PAY_GATEWAY, "https://api.payqixiang.cn/mapi.php", "/mapi.php")) missing.push("KAI_QIXIANG_PAY_GATEWAY(valid HTTPS mapi.php)");
  if (!publicOrigin(environment.KAI_PUBLIC_ORIGIN)) missing.push("KAI_PUBLIC_ORIGIN(valid HTTPS origin)");
  const uniqueMissing = [...new Set(missing)];
  const enabled = environment.KAI_QIXIANG_PAY_ENABLED?.trim() === "1";
  return {
    enabled,
    configured: uniqueMissing.length === 0,
    canCreatePayment: enabled && uniqueMissing.length === 0,
    missing: uniqueMissing,
    merchantAccountRef: environment.KAI_QIXIANG_PAY_PID?.trim() || null,
    channels: paymentChannels(environment),
  } as const;
}

export function qixiangPayCredentialReadiness(environment: QixiangPayEnvironment = runtimeEnvironment()) {
  const missing: string[] = [];
  if (!/^\d{1,18}$/u.test(environment.KAI_QIXIANG_PAY_PID?.trim() || "")) missing.push("KAI_QIXIANG_PAY_PID(valid)");
  if ((environment.KAI_QIXIANG_PAY_KEY?.trim().length ?? 0) < 16) missing.push("KAI_QIXIANG_PAY_KEY(>=16 chars)");
  return { configured: missing.length === 0, missing, merchantAccountRef: environment.KAI_QIXIANG_PAY_PID?.trim() || null } as const;
}

function checkoutConfiguration(environment: QixiangPayEnvironment) {
  const readiness = qixiangPayReadiness(environment);
  if (!readiness.canCreatePayment) throw new QixiangPayError("QIXIANG_PAY_NOT_CONFIGURED", readiness.enabled ? "支付通道配置未完成。" : "支付通道当前保持关闭。");
  return {
    pid: environment.KAI_QIXIANG_PAY_PID!.trim(), key: environment.KAI_QIXIANG_PAY_KEY!.trim(),
    channels: readiness.channels, origin: publicOrigin(environment.KAI_PUBLIC_ORIGIN)!,
    gateway: endpoint(environment.KAI_QIXIANG_PAY_GATEWAY, "https://api.payqixiang.cn/mapi.php", "/mapi.php")!,
  };
}

function credentialConfiguration(environment: QixiangPayEnvironment) {
  const readiness = qixiangPayCredentialReadiness(environment);
  if (!readiness.configured) throw new QixiangPayError("QIXIANG_PAY_NOT_CONFIGURED", "支付通道回调验签配置未完成。");
  return { pid: environment.KAI_QIXIANG_PAY_PID!.trim(), key: environment.KAI_QIXIANG_PAY_KEY!.trim() };
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
  if (checkoutUrl.protocol !== "https:" || checkoutUrl.origin !== config.gateway.origin || checkoutUrl.username || checkoutUrl.password) throw new QixiangPayError("QIXIANG_PAY_OUTCOME_UNKNOWN", "支付服务请求结果需要人工核对。");
  return { provider: "QIXIANG_PAY" as const, checkoutUrl: checkoutUrl.toString(), merchantAccountRef: config.pid, paymentType: selectedType, channel: order.channel, amountCents: order.amountCents, currency: "CNY" as const };
}

export async function verifyQixiangPayNotification(query: URLSearchParams, rawQuery: string, environment: QixiangPayEnvironment = runtimeEnvironment()): Promise<QixiangVerifiedPayment> {
  const config = credentialConfiguration(environment);
  const payload = uniqueParameters(query);
  if (payload.sign_type !== "MD5" || !signaturesEqual(payload.sign ?? "", signQixiangParameters(payload, config.key))) throw new QixiangPayError("QIXIANG_PAY_SIGNATURE_INVALID", "支付通知验签失败。");
  assertOrderId(payload.out_trade_no ?? "");
  if (payload.pid !== config.pid) throw new QixiangPayError("QIXIANG_PAY_MERCHANT_MISMATCH", "支付通知商户不匹配。");
  if ((payload.type !== "alipay" && payload.type !== "wxpay") || payload.trade_status !== "TRADE_SUCCESS") throw new QixiangPayError("QIXIANG_PAY_NOTIFICATION_INVALID", "支付通知状态或通道不匹配。");
  if (!/^[A-Za-z0-9_-]{8,96}$/u.test(payload.trade_no ?? "")) throw new QixiangPayError("QIXIANG_PAY_NOTIFICATION_INVALID", "支付平台订单号无效。");
  const now = new Date().toISOString();
  return { provider: "QIXIANG_PAY", providerEventId: `notify:${payload.trade_no}:TRADE_SUCCESS`, providerTransactionId: payload.trade_no, providerOrderId: payload.out_trade_no, merchantAccountRef: payload.pid, paymentType: payload.type, productName: payload.name || null, merchantParam: payload.param || null, eventType: "CAPTURED", amountCents: parseAmountCents(payload.money), currency: "CNY", occurredAt: now, rawPayloadDigest: await sha256(rawQuery), verificationMethod: "QIXIANG_MD5_NOTIFY", verifiedAt: now, fundsMoved: true };
}
