import { MarketplaceInputError } from "@/lib/marketplace";

const BODY_LIMIT = 32 * 1024;
const WINDOW_MS = 10 * 60 * 1_000;
const MAX_WRITES = 30;

type RateEntry = { count: number; resetAt: number };

declare global {
  var __kaiDemoWriteLimits: Map<string, RateEntry> | undefined;
}

function responseHeaders() {
  return {
    "cache-control": "no-store, max-age=0",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  };
}

export function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: responseHeaders() });
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new MarketplaceInputError("请求来源不正确。");
  }
  if (originUrl.host !== new URL(request.url).host) {
    throw new MarketplaceInputError("跨站写入已被拒绝。");
  }
}

export function assertWriteRate(request: Request) {
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for");
  const key = forwarded?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const limits = (globalThis.__kaiDemoWriteLimits ??= new Map());
  const current = limits.get(key);
  if (!current || current.resetAt <= now) {
    limits.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    current.count += 1;
    if (current.count > MAX_WRITES) throw new Error("RATE_LIMITED");
  }
  if (limits.size > 1_000) {
    for (const [entryKey, entry] of limits) {
      if (entry.resetAt <= now) limits.delete(entryKey);
    }
  }
}

export async function readJsonBody(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new MarketplaceInputError("请使用 JSON 格式提交。");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > BODY_LIMIT) throw new MarketplaceInputError("提交内容过大。");
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > BODY_LIMIT) {
    throw new MarketplaceInputError("提交内容过大。");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new MarketplaceInputError("JSON 内容无法解析。");
  }
}

export function apiErrorResponse(error: unknown) {
  const requestId = crypto.randomUUID();
  if (error instanceof MarketplaceInputError) {
    return jsonResponse(
      { error: { code: "VALIDATION_ERROR", message: error.message, field: error.field, requestId } },
      400,
    );
  }
  if (error instanceof Error && error.message === "DEMAND_NOT_FOUND") {
    return jsonResponse({ error: { code: "DEMAND_NOT_FOUND", message: "对应需求不存在。", requestId } }, 404);
  }
  if (error instanceof Error && error.message === "RATE_LIMITED") {
    return jsonResponse({ error: { code: "RATE_LIMITED", message: "提交过于频繁，请稍后再试。", requestId } }, 429);
  }
  console.error("KAI marketplace API error", requestId, error);
  return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后再试。", requestId } }, 500);
}

export function prepareWrite(request: Request) {
  assertSameOrigin(request);
  assertWriteRate(request);
}
