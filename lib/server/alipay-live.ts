import { AlipaySdk } from "alipay-sdk";

export const ALIPAY_REQUIRED_ENV = [
  "KAI_ALIPAY_APP_ID",
  "KAI_ALIPAY_PRIVATE_KEY",
  "KAI_ALIPAY_PUBLIC_KEY",
  "KAI_ALIPAY_SELLER_ID",
  "KAI_PUBLIC_ORIGIN",
] as const;

export type AlipayEnvironment = Record<string, string | undefined>;

export type AlipayReadiness = {
  enabled: boolean;
  configured: boolean;
  canCreatePayment: boolean;
  missing: string[];
  gateway: string;
  merchantAccountRef: string | null;
};

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

export class AlipayLiveError extends Error {
  readonly code:
    | "ALIPAY_NOT_CONFIGURED"
    | "ALIPAY_INVALID_ORDER"
    | "ALIPAY_SIGNATURE_INVALID"
    | "ALIPAY_MERCHANT_MISMATCH"
    | "ALIPAY_NOTIFICATION_INVALID"
    | "ALIPAY_REQUEST_FAILED";

  constructor(
    code:
      | "ALIPAY_NOT_CONFIGURED"
      | "ALIPAY_INVALID_ORDER"
      | "ALIPAY_SIGNATURE_INVALID"
      | "ALIPAY_MERCHANT_MISMATCH"
      | "ALIPAY_NOTIFICATION_INVALID"
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

function configuredOrigin(value: string) {
  let origin: string;
  try {
    origin = new URL(value).origin;
  } catch {
    throw new AlipayLiveError("ALIPAY_NOT_CONFIGURED", "支付宝 LIVE 回调域名无效。");
  }
  if (!origin.startsWith("https://") && !origin.startsWith("http://localhost")) {
    throw new AlipayLiveError("ALIPAY_NOT_CONFIGURED", "支付宝 LIVE 回调要求 HTTPS 公网域名。\n");
  }
  return origin;
}

export function alipayReadiness(environment: AlipayEnvironment = runtimeEnvironment()): AlipayReadiness {
  const missing = ALIPAY_REQUIRED_ENV.filter((name) => !environment[name]?.trim());
  const enabled = environment.KAI_ALIPAY_ENABLED?.trim() === "1";
  return {
    enabled,
    configured: missing.length === 0,
    canCreatePayment: enabled && missing.length === 0,
    missing: [...missing],
    gateway: environment.KAI_ALIPAY_GATEWAY?.trim() || "https://openapi.alipay.com/gateway.do",
    merchantAccountRef: environment.KAI_ALIPAY_SELLER_ID?.trim() || null,
  };
}

function alipayClient(environment: AlipayEnvironment = runtimeEnvironment()) {
  const readiness = alipayReadiness(environment);
  if (!readiness.canCreatePayment) {
    throw new AlipayLiveError(
      "ALIPAY_NOT_CONFIGURED",
      readiness.enabled
        ? `支付宝 LIVE 尚未配置：${readiness.missing.join(", ")}`
        : "支付宝 LIVE 当前按试运营边界保持关闭。",
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
  if (!alipayClient(environment).checkNotifySignV2(payload)) {
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
    providerEventId: payload.notify_id || `${payload.trade_no}:${payload.trade_status}`,
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
    return await alipayClient(environment).exec("alipay.trade.query", {
      bizContent: { outTradeNo: orderId },
    });
  } catch (error) {
    throw new AlipayLiveError("ALIPAY_REQUEST_FAILED", error instanceof Error ? error.message : "支付宝查单失败。\n");
  }
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
    return await alipayClient(environment).exec("alipay.trade.refund", {
      bizContent: {
        outTradeNo: orderId,
        outRequestNo: refundRequestId,
        refundAmount: amountText(amountCents),
        refundReason: reason.slice(0, 256),
      },
    });
  } catch (error) {
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
    return await alipayClient(environment).exec("alipay.trade.fastpay.refund.query", {
      bizContent: { outTradeNo: orderId, outRequestNo: refundRequestId },
    });
  } catch (error) {
    throw new AlipayLiveError("ALIPAY_REQUEST_FAILED", error instanceof Error ? error.message : "支付宝退款查询失败。\n");
  }
}
