import { MarketplaceInputError } from "@/lib/marketplace";
import { hashText, isSecureMarketplaceRequest } from "@/lib/server/marketplace-actor";
import {
  MarketplaceAccessError,
  MarketplaceCapacityError,
  MarketplaceCsrfError,
  MarketplaceDemandQuoteLimitError,
  MarketplaceHttpsRequiredError,
  MarketplaceIdempotencyConflictError,
  MarketplacePayloadTooLargeError,
  MarketplaceRateLimitError,
  MarketplaceStateConflictError,
} from "@/lib/server/marketplace-errors";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { AccountAuthError } from "@/lib/server/account-auth";
import { ExchangeDomainError, ExchangeIdempotencyConflictError, ExchangeInputError } from "@/lib/server/exchange-errors";

const BODY_LIMIT = 32 * 1024;

export type ApiRequestContext = {
  requestId: string;
  method: string;
  route: string;
  startedAt: number;
  errorCode?: string;
  errorName?: string;
};

export function beginApiRequest(request: Request): ApiRequestContext {
  return {
    requestId: crypto.randomUUID(),
    method: request.method,
    route: new URL(request.url).pathname,
    startedAt: performance.now(),
  };
}

function logApiRequest(context: ApiRequestContext, status: number) {
  const durationMs = Math.max(0, performance.now() - context.startedAt);
  const entry = {
    level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
    event: "api_request",
    requestId: context.requestId,
    method: context.method,
    route: context.route,
    status,
    durationMs: Math.round(durationMs * 10) / 10,
    release: typeof process !== "undefined" ? (process.env.KAI_RELEASE_SHA ?? "worker") : "worker",
    errorCode: context.errorCode,
    errorName: context.errorName,
    occurredAt: new Date().toISOString(),
  };
  const write = status >= 500 ? console.error : status >= 400 ? console.warn : console.info;
  write(JSON.stringify(entry));
}

function responseHeaders(extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("referrer-policy", "same-origin");
  headers.set("x-content-type-options", "nosniff");
  return headers;
}

export function jsonResponse(value: unknown, status = 200, headers?: HeadersInit, context?: ApiRequestContext) {
  const finalHeaders = responseHeaders(headers);
  if (context) {
    finalHeaders.set("x-request-id", context.requestId);
    logApiRequest(context, status);
  }
  return new Response(JSON.stringify(value), { status, headers: finalHeaders });
}

export function assertSameOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    throw new MarketplaceCsrfError("ORIGIN_REJECTED");
  }
  const origin = request.headers.get("origin");
  if (!origin) throw new MarketplaceCsrfError("ORIGIN_REJECTED");
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new MarketplaceCsrfError("ORIGIN_REJECTED");
  }
  const configuredOrigin = typeof process !== "undefined" ? process.env.KAI_PUBLIC_ORIGIN : undefined;
  const expectedOrigin = configuredOrigin ? new URL(configuredOrigin).origin : new URL(request.url).origin;
  if (originUrl.origin !== expectedOrigin) {
    throw new MarketplaceCsrfError("ORIGIN_REJECTED");
  }
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function assertCsrf(request: Request, actor: MarketplaceActor) {
  const token = request.headers.get("x-kai-csrf") ?? "";
  if (!constantTimeEqual(token, actor.csrfToken)) throw new MarketplaceCsrfError("CSRF_REJECTED");
}

export function assertSecureWrite(request: Request) {
  const requireHttps = typeof process !== "undefined" && process.env.KAI_REQUIRE_HTTPS_WRITES === "1";
  if (requireHttps && !isSecureMarketplaceRequest(request)) {
    throw new MarketplaceHttpsRequiredError();
  }
}

export async function readJsonBody(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new MarketplaceInputError("请使用 JSON 格式提交。");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > BODY_LIMIT) throw new MarketplacePayloadTooLargeError();
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > BODY_LIMIT) {
        await reader.cancel("payload too large");
        throw new MarketplacePayloadTooLargeError();
      }
      chunks.push(value);
    }
  }
  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
  } catch {
    throw new MarketplaceInputError("提交内容不是有效的 UTF-8 文本。");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new MarketplaceInputError("JSON 内容无法解析。");
  }
}

export function requireIdempotencyKey(request: Request) {
  const value = request.headers.get("idempotency-key")?.trim();
  if (!value || !/^[A-Za-z0-9._:-]{16,128}$/u.test(value)) {
    throw new MarketplaceInputError("提交标识缺失或格式不正确，请刷新后重试。", "idempotency-key");
  }
  return value;
}

export async function mutationHash(value: unknown) {
  return hashText(JSON.stringify(value));
}

export type PageQuery<View extends string> = {
  view: View;
  limit: number;
  cursor: string | null;
};

export function readPageQuery<View extends string>(
  request: Request,
  allowedViews: readonly View[],
  defaultView: View,
): PageQuery<View> {
  const search = new URL(request.url).searchParams;
  const rawView = search.get("view") ?? defaultView;
  if (!allowedViews.includes(rawView as View)) {
    throw new MarketplaceInputError("请求视图不受支持。", "view");
  }
  const rawLimit = search.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new MarketplaceInputError("每页数量应为 1–50 的整数。", "limit");
  }
  const cursor = search.get("cursor");
  if (cursor && !/^[A-Za-z0-9_.-]{8,512}$/u.test(cursor)) {
    throw new MarketplaceInputError("分页游标格式不正确。", "cursor");
  }
  return { view: rawView as View, limit, cursor };
}

export function apiErrorResponse(error: unknown, extraHeaders?: HeadersInit, context?: ApiRequestContext) {
  const requestId = context?.requestId ?? crypto.randomUUID();
  const headers = new Headers(extraHeaders);
  if (error instanceof AccountAuthError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message, requestId } },
      error.status,
      headers,
      context ? { ...context, errorCode: error.code, errorName: error.name } : undefined,
    );
  }
  if (error instanceof MarketplaceInputError || error instanceof ExchangeInputError) {
    return jsonResponse(
      { error: { code: "VALIDATION_ERROR", message: error.message, field: error.field, requestId } },
      400,
      headers,
      context ? { ...context, errorCode: "VALIDATION_ERROR", errorName: error.name } : undefined,
    );
  }
  if (error instanceof ExchangeDomainError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message, requestId } },
      error.status,
      headers,
      context ? { ...context, errorCode: error.code, errorName: error.name } : undefined,
    );
  }
  if (error instanceof MarketplaceCsrfError) {
    const message = error.code === "CSRF_REJECTED" ? "安全校验已失效，请刷新页面后重试。" : "请求来源未通过安全校验。";
    return jsonResponse({ error: { code: error.code, message, requestId } }, 403, headers, context ? { ...context, errorCode: error.code, errorName: error.name } : undefined);
  }
  if (error instanceof MarketplacePayloadTooLargeError) {
    return jsonResponse({ error: { code: "PAYLOAD_TOO_LARGE", message: "提交内容超过 32KB 限制。", requestId } }, 413, headers, context ? { ...context, errorCode: "PAYLOAD_TOO_LARGE", errorName: error.name } : undefined);
  }
  if (error instanceof MarketplaceHttpsRequiredError) {
    return jsonResponse({ error: { code: "HTTPS_REQUIRED", message: "会员写入仅在 HTTPS 安全连接上开放。", requestId } }, 426, headers, context ? { ...context, errorCode: "HTTPS_REQUIRED", errorName: error.name } : undefined);
  }
  if (error instanceof MarketplaceAccessError) {
    const message = error.code === "DEMAND_NOT_AVAILABLE" ? "该需求当前不可响应。" : "对应需求不存在。";
    return jsonResponse({ error: { code: error.code, message, requestId } }, 404, headers, context ? { ...context, errorCode: error.code, errorName: error.name } : undefined);
  }
  if (error instanceof MarketplaceIdempotencyConflictError || error instanceof ExchangeIdempotencyConflictError) {
    return jsonResponse(
      { error: { code: "IDEMPOTENCY_CONFLICT", message: "同一提交标识对应了不同内容，请刷新后重试。", requestId } },
      409,
      headers,
      context ? { ...context, errorCode: "IDEMPOTENCY_CONFLICT", errorName: error.name } : undefined,
    );
  }
  if (error instanceof MarketplaceStateConflictError) {
    return jsonResponse(
      { error: { code: "STATE_CONFLICT", message: "需求状态刚刚发生变化，请刷新后重试。", requestId } },
      409,
      headers,
      context ? { ...context, errorCode: "STATE_CONFLICT", errorName: error.name } : undefined,
    );
  }
  if (error instanceof MarketplaceCapacityError) {
    headers.set("retry-after", String(error.retryAfterSeconds));
    return jsonResponse(
      { error: { code: "MARKETPLACE_CAPACITY_REACHED", message: "当前提交队列已满，请稍后再试。", requestId } },
      503,
      headers,
      context ? { ...context, errorCode: "MARKETPLACE_CAPACITY_REACHED", errorName: error.name } : undefined,
    );
  }
  if (error instanceof MarketplaceDemandQuoteLimitError) {
    headers.set("retry-after", String(error.retryAfterSeconds));
    return jsonResponse(
      { error: { code: "DEMAND_QUOTE_LIMIT_REACHED", message: "该需求收到的报价数量已达上限，请响应其他需求。", requestId } },
      429,
      headers,
      context ? { ...context, errorCode: "DEMAND_QUOTE_LIMIT_REACHED", errorName: error.name } : undefined,
    );
  }
  if (error instanceof MarketplaceRateLimitError) {
    headers.set("retry-after", String(error.retryAfterSeconds));
    return jsonResponse({ error: { code: "RATE_LIMITED", message: "提交过于频繁，请稍后再试。", requestId } }, 429, headers, context ? { ...context, errorCode: "RATE_LIMITED", errorName: error.name } : undefined);
  }
  return jsonResponse(
    { error: { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后再试。", requestId } },
    500,
    headers,
    context ? { ...context, errorCode: "INTERNAL_ERROR", errorName: error instanceof Error ? error.name : "UnknownError" } : undefined,
  );
}

export function prepareWrite(request: Request, actor: MarketplaceActor) {
  assertSecureWrite(request);
  assertSameOrigin(request);
  assertCsrf(request, actor);
}
