import { AlipaySdk } from "alipay-sdk";
import {
  createPrivateKey,
  createPublicKey,
  sign as signPayload,
  verify as verifyPayload,
} from "node:crypto";

export const ALIPAY_REQUIRED_ENV = [
  "KAI_ALIPAY_APP_ID",
  "KAI_ALIPAY_PRIVATE_KEY",
  "KAI_ALIPAY_PUBLIC_KEY",
  "KAI_ALIPAY_SELLER_ID",
  "KAI_ALIPAY_APPROVAL_REFERENCE",
  "KAI_PUBLIC_ORIGIN",
] as const;

const ALIPAY_PRODUCTION_GATEWAY = "https://openapi.alipay.com/gateway.do";
const ALIPAY_IDENTIFIER_PATTERN = /^\d{16}$/u;
const ALIPAY_APPROVAL_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/u;
const ALIPAY_CREDENTIAL_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/u;

export type AlipayEnvironment = Record<string, string | undefined>;

export type AlipayReadiness = {
  enabled: boolean;
  reconciliationEnabled: boolean;
  configured: boolean;
  canCreatePayment: boolean;
  canReconcilePayment: boolean;
  missing: string[];
  gateway: string;
  merchantAccountRef: string | null;
  channels: readonly ["ALIPAY"];
};

export type AlipayReconciliationReadiness = Pick<
  AlipayReadiness,
  "configured" | "gateway" | "merchantAccountRef" | "missing" | "reconciliationEnabled" | "canReconcilePayment"
> & { enabled: boolean };

export type AlipayOrderSnapshot = {
  orderId: string;
  amountCents: number;
  subject: string;
  expiresMinutes?: number;
  returnPath?: string;
};

export type VerifiedAlipayNotification = {
  provider: "ALIPAY";
  environment: "LIVE";
  providerEventId: string;
  providerTransactionId: string;
  providerOrderId: string;
  merchantAccountRef: string;
  eventType: "CAPTURED" | "CLOSED";
  amountCents: number;
  currency: "CNY";
  occurredAt: string;
  rawPayloadDigest: string;
  verificationMethod: "ALIPAY_RSA2_NOTIFY";
  verifiedAt: string;
  fundsMoved: boolean;
};

export type VerifiedAlipayTrade = Readonly<{
  provider: "ALIPAY";
  environment: "LIVE";
  providerEventId: string;
  providerTransactionId: string;
  providerOrderId: string;
  merchantAccountRef: string;
  eventType: "CAPTURED" | "CLOSED" | "PENDING";
  amountCents: number;
  currency: "CNY";
  occurredAt: string;
  rawPayloadDigest: string;
  verificationMethod: "ALIPAY_RSA2_ORDER_QUERY";
  verifiedAt: string;
  fundsMoved: boolean;
}>;

export type AlipayTradeQueryExecutor = (
  method: "alipay.trade.query",
  parameters: { bizContent: { outTradeNo: string } },
  options: { validateSign: true },
) => Promise<unknown>;

export class AlipayLiveError extends Error {
  readonly code:
    | "ALIPAY_NOT_CONFIGURED"
    | "ALIPAY_INVALID_ORDER"
    | "ALIPAY_SIGNATURE_INVALID"
    | "ALIPAY_MERCHANT_MISMATCH"
    | "ALIPAY_NOTIFICATION_INVALID"
    | "ALIPAY_TRADE_INVALID"
    | "ALIPAY_TRADE_MISMATCH"
    | "ALIPAY_REQUEST_FAILED";

  constructor(
    code:
      | "ALIPAY_NOT_CONFIGURED"
      | "ALIPAY_INVALID_ORDER"
      | "ALIPAY_SIGNATURE_INVALID"
      | "ALIPAY_MERCHANT_MISMATCH"
      | "ALIPAY_NOTIFICATION_INVALID"
      | "ALIPAY_TRADE_INVALID"
      | "ALIPAY_TRADE_MISMATCH"
      | "ALIPAY_REQUEST_FAILED",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "AlipayLiveError";
  }
}

function runtimeEnvironment(): AlipayEnvironment {
  return typeof process === "undefined" ? {} : process.env;
}

function normalizedPem(value: string) {
  return value.replaceAll("\\n", "\n").trim();
}

function validCredentialRotation(value: string | undefined) {
  const text = value?.trim() || "";
  const timestamp = Date.parse(text);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(text)
    && Number.isFinite(timestamp)
    && timestamp >= Date.parse("2020-01-01T00:00:00.000Z")
    && timestamp <= Date.now() + 5 * 60 * 1000;
}

function validCredentialLifecycle(environment: AlipayEnvironment) {
  return ALIPAY_CREDENTIAL_VERSION_PATTERN.test(environment.KAI_ALIPAY_CREDENTIAL_VERSION?.trim() || "")
    || validCredentialRotation(environment.KAI_ALIPAY_CREDENTIAL_ROTATED_AT);
}

function validPublicOrigin(value: string | undefined) {
  try {
    const url = new URL(value?.trim() || "");
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && url.pathname === "/"
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function validRsaCredentials(environment: AlipayEnvironment) {
  try {
    const privateKey = createPrivateKey(normalizedPem(environment.KAI_ALIPAY_PRIVATE_KEY || ""));
    const applicationPublicKey = createPublicKey(privateKey);
    const alipayPublicKey = createPublicKey(normalizedPem(environment.KAI_ALIPAY_PUBLIC_KEY || ""));
    if (privateKey.asymmetricKeyType !== "rsa"
      || applicationPublicKey.asymmetricKeyType !== "rsa"
      || alipayPublicKey.asymmetricKeyType !== "rsa") return false;
    const probe = Buffer.from("kai-cloud-alipay-readiness-v1", "utf8");
    const signature = signPayload("sha256", probe, privateKey);
    if (!verifyPayload("sha256", probe, applicationPublicKey, signature)) return false;
    // A known-invalid signature must be accepted as an input and rejected as a
    // signature. This exercises the configured Alipay public key's RSA verify
    // path without requiring possession of Alipay's private key.
    return verifyPayload("sha256", probe, alipayPublicKey, Buffer.alloc(signature.byteLength)) === false;
  } catch {
    return false;
  }
}

function configuredOrigin(value: string) {
  if (!validPublicOrigin(value)) {
    throw new AlipayLiveError("ALIPAY_NOT_CONFIGURED", "支付宝 LIVE 回调域名无效。");
  }
  return new URL(value).origin;
}

export function alipayReadiness(environment: AlipayEnvironment = runtimeEnvironment()): AlipayReadiness {
  const missing: string[] = ALIPAY_REQUIRED_ENV.filter((name) => !environment[name]?.trim());
  const enabled = environment.KAI_PAYMENT_PILOT_ENABLED?.trim() === "1"
    && environment.KAI_ALIPAY_ENABLED?.trim() === "1";
  const reconciliationEnabled = environment.KAI_ALIPAY_RECONCILIATION_ENABLED?.trim() === "1";
  if (environment.KAI_ALIPAY_APP_ID?.trim() && !ALIPAY_IDENTIFIER_PATTERN.test(environment.KAI_ALIPAY_APP_ID.trim())) {
    missing.push("KAI_ALIPAY_APP_ID(valid 16-digit App ID)");
  }
  if (environment.KAI_ALIPAY_SELLER_ID?.trim() && !ALIPAY_IDENTIFIER_PATTERN.test(environment.KAI_ALIPAY_SELLER_ID.trim())) {
    missing.push("KAI_ALIPAY_SELLER_ID(valid 16-digit Seller ID)");
  }
  if ((environment.KAI_ALIPAY_GATEWAY?.trim() || ALIPAY_PRODUCTION_GATEWAY) !== ALIPAY_PRODUCTION_GATEWAY) {
    missing.push("KAI_ALIPAY_GATEWAY(official production gateway)");
  }
  if (environment.KAI_ALIPAY_PRIVATE_KEY_TYPE !== undefined
    && environment.KAI_ALIPAY_PRIVATE_KEY_TYPE !== "PKCS1"
    && environment.KAI_ALIPAY_PRIVATE_KEY_TYPE !== "PKCS8") {
    missing.push("KAI_ALIPAY_PRIVATE_KEY_TYPE(PKCS1 or PKCS8)");
  }
  if (environment.KAI_PUBLIC_ORIGIN?.trim() && !validPublicOrigin(environment.KAI_PUBLIC_ORIGIN)) {
    missing.push("KAI_PUBLIC_ORIGIN(HTTPS origin)");
  }
  if (environment.KAI_ALIPAY_APPROVAL_REFERENCE?.trim()
    && !ALIPAY_APPROVAL_REFERENCE_PATTERN.test(environment.KAI_ALIPAY_APPROVAL_REFERENCE.trim())) {
    missing.push("KAI_ALIPAY_APPROVAL_REFERENCE(valid approval reference)");
  }
  if (!validCredentialLifecycle(environment)) {
    missing.push("KAI_ALIPAY_CREDENTIAL_VERSION or KAI_ALIPAY_CREDENTIAL_ROTATED_AT");
  }
  if (environment.KAI_ALIPAY_PRIVATE_KEY?.trim() && environment.KAI_ALIPAY_PUBLIC_KEY?.trim()
    && !validRsaCredentials(environment)) {
    missing.push("KAI_ALIPAY_RSA_CREDENTIALS(valid RSA signing and verification keys)");
  }
  const uniqueMissing = [...new Set(missing)];
  const configured = uniqueMissing.length === 0;
  return {
    enabled,
    reconciliationEnabled,
    configured,
    canCreatePayment: enabled && configured,
    canReconcilePayment: reconciliationEnabled && configured,
    missing: uniqueMissing,
    gateway: ALIPAY_PRODUCTION_GATEWAY,
    merchantAccountRef: environment.KAI_ALIPAY_SELLER_ID?.trim() || null,
    channels: ["ALIPAY"],
  };
}

export function alipayReconciliationReadiness(
  environment: AlipayEnvironment = runtimeEnvironment(),
): AlipayReconciliationReadiness {
  const readiness = alipayReadiness(environment);
  return {
    enabled: readiness.reconciliationEnabled,
    reconciliationEnabled: readiness.reconciliationEnabled,
    configured: readiness.configured,
    canReconcilePayment: readiness.canReconcilePayment,
    missing: readiness.missing,
    gateway: readiness.gateway,
    merchantAccountRef: readiness.merchantAccountRef,
  };
}

function alipayClient(
  environment: AlipayEnvironment = runtimeEnvironment(),
  purpose: "checkout" | "reconciliation" = "checkout",
) {
  const readiness = alipayReadiness(environment);
  const available = purpose === "checkout" ? readiness.canCreatePayment : readiness.canReconcilePayment;
  if (!available) {
    const operationEnabled = purpose === "checkout" ? readiness.enabled : readiness.reconciliationEnabled;
    throw new AlipayLiveError(
      "ALIPAY_NOT_CONFIGURED",
      operationEnabled
        ? `支付宝 LIVE 尚未配置：${readiness.missing.join(", ")}`
        : purpose === "checkout"
          ? "支付宝 LIVE 新建收银当前关闭。"
          : "支付宝 LIVE 存量核单与退款当前关闭。",
    );
  }
  return new AlipaySdk({
    appId: environment.KAI_ALIPAY_APP_ID!.trim(),
    privateKey: normalizedPem(environment.KAI_ALIPAY_PRIVATE_KEY!),
    alipayPublicKey: normalizedPem(environment.KAI_ALIPAY_PUBLIC_KEY!),
    signType: "RSA2",
    keyType: environment.KAI_ALIPAY_PRIVATE_KEY_TYPE === "PKCS1" ? "PKCS1" : "PKCS8",
    gateway: readiness.gateway,
    timeout: 8_000,
    camelcase: false,
  });
}

function amountText(amountCents: number) {
  if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 100_000_000) {
    throw new AlipayLiveError("ALIPAY_INVALID_ORDER", "支付金额必须是有效的人民币整数分。\n");
  }
  return (amountCents / 100).toFixed(2);
}

function parseAmountCents(value: string) {
  if (!/^\d{1,9}(?:\.\d{1,2})?$/u.test(value)) {
    throw new AlipayLiveError("ALIPAY_NOTIFICATION_INVALID", "支付宝通知金额格式无效。\n");
  }
  const [yuan, fraction = ""] = value.split(".");
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) {
    throw new AlipayLiveError("ALIPAY_NOTIFICATION_INVALID", "支付宝通知金额超出允许范围。\n");
  }
  return cents;
}

function assertOrderId(orderId: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/u.test(orderId)) {
    throw new AlipayLiveError("ALIPAY_INVALID_ORDER", "商户订单号格式无效。\n");
  }
}

export function createAlipayCheckoutUrl(
  order: AlipayOrderSnapshot,
  environment: AlipayEnvironment = runtimeEnvironment(),
) {
  assertOrderId(order.orderId);
  const client = alipayClient(environment);
  const origin = configuredOrigin(environment.KAI_PUBLIC_ORIGIN!);
  const expiresMinutes = order.expiresMinutes ?? 15;
  if (!Number.isInteger(expiresMinutes) || expiresMinutes < 1 || expiresMinutes > 30) {
    throw new AlipayLiveError("ALIPAY_INVALID_ORDER", "支付有效期必须为 1–30 分钟。\n");
  }
  const subject = order.subject.trim();
  if (!subject || subject.length > 128) {
    throw new AlipayLiveError("ALIPAY_INVALID_ORDER", "支付宝订单标题必须为 1–128 个字符。\n");
  }
  const returnPath = order.returnPath ?? `/supply/orders/${encodeURIComponent(order.orderId)}?payment=return`;
  if (!returnPath.startsWith("/") || returnPath.startsWith("//")) {
    throw new AlipayLiveError("ALIPAY_INVALID_ORDER", "支付返回地址无效。\n");
  }

  const checkoutUrl = client.pageExecute("alipay.trade.page.pay", "GET", {
    notifyUrl: `${origin}/api/v1/payments/alipay/notify`,
    returnUrl: `${origin}${returnPath}`,
    bizContent: {
      outTradeNo: order.orderId,
      productCode: "FAST_INSTANT_TRADE_PAY",
      totalAmount: amountText(order.amountCents),
      subject,
      timeoutExpress: `${expiresMinutes}m`,
    },
  });

  return {
    provider: "ALIPAY" as const,
    environment: "LIVE" as const,
    checkoutUrl,
    amountCents: order.amountCents,
    currency: "CNY" as const,
    expiresAt: new Date(Date.now() + expiresMinutes * 60_000).toISOString(),
  };
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function notificationObject(body: URLSearchParams) {
  const record: Record<string, string> = {};
  for (const [key, value] of body.entries()) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      throw new AlipayLiveError("ALIPAY_NOTIFICATION_INVALID", `支付宝通知字段重复：${key}`);
    }
    record[key] = value;
  }
  return record;
}

export async function verifyAlipayNotification(
  body: URLSearchParams,
  rawBody: string,
  environment: AlipayEnvironment = runtimeEnvironment(),
): Promise<VerifiedAlipayNotification> {
  const payload = notificationObject(body);
  if (!alipayClient(environment, "reconciliation").checkNotifySignV2(payload)) {
    throw new AlipayLiveError("ALIPAY_SIGNATURE_INVALID", "支付宝异步通知验签失败。\n");
  }

  const expectedAppId = environment.KAI_ALIPAY_APP_ID!.trim();
  const expectedSellerId = environment.KAI_ALIPAY_SELLER_ID!.trim();
  if (payload.app_id !== expectedAppId || payload.seller_id !== expectedSellerId) {
    throw new AlipayLiveError("ALIPAY_MERCHANT_MISMATCH", "支付宝通知的应用或收款主体不匹配。\n");
  }
  assertOrderId(payload.out_trade_no ?? "");
  if (!payload.trade_no || !/^\d{16,64}$/u.test(payload.trade_no)) {
    throw new AlipayLiveError("ALIPAY_NOTIFICATION_INVALID", "支付宝交易号格式无效。\n");
  }
  if (payload.trade_status !== "TRADE_SUCCESS" && payload.trade_status !== "TRADE_FINISHED" && payload.trade_status !== "TRADE_CLOSED") {
    throw new AlipayLiveError("ALIPAY_NOTIFICATION_INVALID", `不支持的支付宝交易状态：${payload.trade_status ?? "缺失"}`);
  }

  const eventType = payload.trade_status === "TRADE_CLOSED" ? "CLOSED" : "CAPTURED";
  const occurredAt = payload.gmt_payment || payload.gmt_close || payload.notify_time;
  const parsedOccurredAt = occurredAt ? new Date(`${occurredAt.replace(" ", "T")}+08:00`) : new Date();
  const now = new Date().toISOString();

  return {
    provider: "ALIPAY",
    environment: "LIVE",
    providerEventId: `alipay:notify:${payload.notify_id || `${payload.trade_no}:${payload.trade_status}`}`,
    providerTransactionId: payload.trade_no,
    providerOrderId: payload.out_trade_no,
    merchantAccountRef: payload.seller_id,
    eventType,
    amountCents: parseAmountCents(payload.total_amount ?? ""),
    currency: "CNY",
    occurredAt: Number.isNaN(parsedOccurredAt.getTime()) ? now : parsedOccurredAt.toISOString(),
    rawPayloadDigest: await sha256Text(rawBody),
    verificationMethod: "ALIPAY_RSA2_NOTIFY",
    verifiedAt: now,
    fundsMoved: eventType === "CAPTURED",
  };
}

export async function queryAlipayTrade(orderId: string, environment: AlipayEnvironment = runtimeEnvironment()) {
  assertOrderId(orderId);
  try {
    return await alipayClient(environment, "reconciliation").exec("alipay.trade.query", {
      bizContent: { outTradeNo: orderId },
    }, { validateSign: true });
  } catch (error) {
    if (error instanceof AlipayLiveError) throw error;
    throw new AlipayLiveError("ALIPAY_REQUEST_FAILED", error instanceof Error ? error.message : "支付宝查单失败。\n");
  }
}

function queryField(payload: Record<string, unknown>, snakeCase: string, camelCase: string) {
  const value = payload[snakeCase] ?? payload[camelCase];
  return typeof value === "string" ? value.trim() : "";
}

function queryOccurredAt(payload: Record<string, unknown>, fallback: string) {
  const value = queryField(payload, "send_pay_date", "sendPayDate")
    || queryField(payload, "gmt_payment", "gmtPayment")
    || queryField(payload, "gmt_close", "gmtClose");
  if (!value) return fallback;
  const parsed = new Date(`${value.replace(" ", "T")}+08:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new AlipayLiveError("ALIPAY_TRADE_INVALID", "支付宝查单时间无效。");
  }
  return parsed.toISOString();
}

export async function queryVerifiedAlipayTrade(
  expected: { orderId: string; amountCents: number },
  environment: AlipayEnvironment = runtimeEnvironment(),
  executor?: AlipayTradeQueryExecutor,
): Promise<VerifiedAlipayTrade> {
  assertOrderId(expected.orderId);
  amountText(expected.amountCents);
  const client = alipayClient(environment, "reconciliation");
  const execute: AlipayTradeQueryExecutor = executor
    ?? ((method, parameters, options) => client.exec(method, parameters, options));
  let result: unknown;
  try {
    result = await execute(
      "alipay.trade.query",
      { bizContent: { outTradeNo: expected.orderId } },
      { validateSign: true },
    );
  } catch (error) {
    if (error instanceof AlipayLiveError) throw error;
    throw new AlipayLiveError("ALIPAY_REQUEST_FAILED", error instanceof Error ? error.message : "支付宝查单失败。");
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new AlipayLiveError("ALIPAY_TRADE_INVALID", "支付宝查单响应格式无效。");
  }
  const payload = result as Record<string, unknown>;
  if (queryField(payload, "code", "code") !== "10000") {
    throw new AlipayLiveError("ALIPAY_REQUEST_FAILED", "支付宝未返回成功的查单结果。");
  }
  const orderId = queryField(payload, "out_trade_no", "outTradeNo");
  const providerTransactionId = queryField(payload, "trade_no", "tradeNo");
  const status = queryField(payload, "trade_status", "tradeStatus");
  const totalAmount = queryField(payload, "total_amount", "totalAmount");
  if (!/^[0-9]{16,64}$/u.test(providerTransactionId)) {
    throw new AlipayLiveError("ALIPAY_TRADE_INVALID", "支付宝查单交易号无效。");
  }
  let amountCents: number;
  try {
    amountCents = parseAmountCents(totalAmount);
  } catch {
    throw new AlipayLiveError("ALIPAY_TRADE_INVALID", "支付宝查单金额无效。");
  }
  if (orderId !== expected.orderId || amountCents !== expected.amountCents) {
    throw new AlipayLiveError("ALIPAY_TRADE_MISMATCH", "支付宝查单结果与付款单不一致，需要人工核对。");
  }
  const eventType = status === "TRADE_SUCCESS" || status === "TRADE_FINISHED"
    ? "CAPTURED"
    : status === "TRADE_CLOSED"
      ? "CLOSED"
      : status === "WAIT_BUYER_PAY"
        ? "PENDING"
        : null;
  if (!eventType) {
    throw new AlipayLiveError("ALIPAY_TRADE_INVALID", `不支持的支付宝查单状态：${status || "缺失"}`);
  }
  const verifiedAt = new Date().toISOString();
  const rawPayload = JSON.stringify(payload);
  return {
    provider: "ALIPAY",
    environment: "LIVE",
    providerEventId: `alipay:query:${providerTransactionId}:${status}`,
    providerTransactionId,
    providerOrderId: orderId,
    merchantAccountRef: environment.KAI_ALIPAY_SELLER_ID!.trim(),
    eventType,
    amountCents,
    currency: "CNY",
    occurredAt: queryOccurredAt(payload, verifiedAt),
    rawPayloadDigest: await sha256Text(rawPayload),
    verificationMethod: "ALIPAY_RSA2_ORDER_QUERY",
    verifiedAt,
    fundsMoved: eventType === "CAPTURED",
  };
}

export async function refundAlipayTrade(
  orderId: string,
  refundRequestId: string,
  amountCents: number,
  reason: string,
  environment: AlipayEnvironment = runtimeEnvironment(),
) {
  assertOrderId(orderId);
  if (!/^[A-Za-z0-9_-]{8,64}$/u.test(refundRequestId)) {
    throw new AlipayLiveError("ALIPAY_INVALID_ORDER", "退款请求号格式无效。\n");
  }
  try {
    return await alipayClient(environment, "reconciliation").exec("alipay.trade.refund", {
      bizContent: {
        outTradeNo: orderId,
        outRequestNo: refundRequestId,
        refundAmount: amountText(amountCents),
        refundReason: reason.slice(0, 256),
      },
    }, { validateSign: true });
  } catch (error) {
    if (error instanceof AlipayLiveError) throw error;
    throw new AlipayLiveError("ALIPAY_REQUEST_FAILED", error instanceof Error ? error.message : "支付宝退款请求失败。\n");
  }
}

export async function queryAlipayRefund(
  orderId: string,
  refundRequestId: string,
  environment: AlipayEnvironment = runtimeEnvironment(),
) {
  assertOrderId(orderId);
  try {
    return await alipayClient(environment, "reconciliation").exec("alipay.trade.fastpay.refund.query", {
      bizContent: { outTradeNo: orderId, outRequestNo: refundRequestId },
    }, { validateSign: true });
  } catch (error) {
    if (error instanceof AlipayLiveError) throw error;
    throw new AlipayLiveError("ALIPAY_REQUEST_FAILED", error instanceof Error ? error.message : "支付宝退款查询失败。\n");
  }
}
