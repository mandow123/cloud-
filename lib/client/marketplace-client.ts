"use client";

export type MarketplaceSession = {
  source: "platform" | "anonymous-session";
  csrfToken: string;
  expiresAt: string;
  retentionDays: number;
};

export type MarketplacePageInfo = {
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
};

export type MarketplacePage<T> = {
  items: T[];
  count: number;
  updatedAt: string | null;
  servedAt?: string;
  source?: string;
  refreshAfterSeconds?: number | null;
  refreshPolicy?: string | null;
  pageInfo: MarketplacePageInfo;
  view: string;
};

type MarketplaceErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    field?: string;
    requestId?: string;
  };
};

export class MarketplaceApiError extends Error {
  readonly code: string;
  readonly field?: string;
  readonly requestId?: string;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor({
    code,
    message,
    field,
    requestId,
    status,
    retryAfterSeconds,
  }: {
    code: string;
    message: string;
    field?: string;
    requestId?: string;
    status: number;
    retryAfterSeconds?: number;
  }) {
    super(message);
    this.name = "MarketplaceApiError";
    this.code = code;
    this.field = field;
    this.requestId = requestId;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

let sessionPromise: Promise<MarketplaceSession> | null = null;

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

async function fetchJson<T>(path: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...init.headers,
      },
      signal: controller.signal,
    });
    const raw = await response.text();
    let body: unknown = null;

    if (raw) {
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        body = null;
      }
    }

    if (!response.ok) {
      const payload = body && typeof body === "object" ? (body as MarketplaceErrorPayload) : null;
      const serverError = payload?.error;
      throw new MarketplaceApiError({
        code: serverError?.code ?? `HTTP_${response.status}`,
        message: serverError?.message ?? "服务暂时不可用，请稍后重试。",
        field: serverError?.field,
        requestId: serverError?.requestId,
        status: response.status,
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
      });
    }

    if (body === null) {
      throw new MarketplaceApiError({
        code: "INVALID_RESPONSE",
        message: "服务返回了无法识别的内容，请稍后重试。",
        status: response.status,
      });
    }

    return body as T;
  } catch (error) {
    if (error instanceof MarketplaceApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new MarketplaceApiError({
        code: "REQUEST_TIMEOUT",
        message: "请求等待时间过长，请检查网络后重试。",
        status: 0,
      });
    }
    throw new MarketplaceApiError({
      code: "NETWORK_ERROR",
      message: "暂时无法连接服务，请检查网络后重试。",
      status: 0,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

export function getMarketplaceSession(forceRefresh = false) {
  if (forceRefresh) sessionPromise = null;
  if (!sessionPromise) {
    sessionPromise = fetchJson<{ session: MarketplaceSession }>("/api/session", { cache: "no-store" })
      .then((result) => {
        if (!result.session || typeof result.session.csrfToken !== "string" || result.session.csrfToken.length === 0) {
          throw new MarketplaceApiError({
            code: "INVALID_RESPONSE",
            message: "会话服务返回了无法识别的内容，请稍后重试。",
            status: 200,
          });
        }
        return result.session;
      })
      .catch((error) => {
        sessionPromise = null;
        throw error;
      });
  }
  return sessionPromise;
}

export async function marketplaceGet<T>(path: string, timeoutMs = 12_000) {
  await getMarketplaceSession();
  return fetchJson<T>(path, { cache: "no-store" }, timeoutMs);
}

export async function exchangeGet<T>(path: string, role: "buyer" | "supplier" | "ops", timeoutMs = 12_000) {
  await getMarketplaceSession();
  return fetchJson<T>(path, {
    cache: "no-store",
    headers: { "x-kai-workspace-role": role },
  }, timeoutMs);
}

export async function marketplacePost<
  TRecord,
  TResponse extends { record: TRecord; replayed: boolean } = { record: TRecord; replayed: boolean },
>(
  path: string,
  payload: unknown,
  idempotencyKey: string,
  timeoutMs = 15_000,
) {
  const send = async (session: MarketplaceSession) => fetchJson<TResponse>(
    path,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kai-csrf": session.csrfToken,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    },
    timeoutMs,
  ).then((result) => {
    if (!result || typeof result !== "object" || !("record" in result) || !result.record) {
      throw new MarketplaceApiError({
        code: "INVALID_RESPONSE",
        message: "写入服务返回了无法识别的内容，请稍后重试。",
        status: 200,
      });
    }
    return result;
  });

  try {
    return await send(await getMarketplaceSession());
  } catch (error) {
    if (error instanceof MarketplaceApiError && error.code === "CSRF_REJECTED") {
      return send(await getMarketplaceSession(true));
    }
    throw error;
  }
}

export async function marketplacePut<TRecord>(
  path: string,
  payload: unknown,
  idempotencyKey: string,
  timeoutMs = 15_000,
) {
  const send = async (session: MarketplaceSession) => fetchJson<{ record: TRecord }>(
    path,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-kai-csrf": session.csrfToken,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    },
    timeoutMs,
  ).then((result) => {
    if (!result || typeof result !== "object" || !("record" in result) || !result.record) {
      throw new MarketplaceApiError({
        code: "INVALID_RESPONSE",
        message: "写入服务返回了无法识别的内容，请稍后重试。",
        status: 200,
      });
    }
    return result;
  });

  try {
    return await send(await getMarketplaceSession());
  } catch (error) {
    if (error instanceof MarketplaceApiError && error.code === "CSRF_REJECTED") {
      return send(await getMarketplaceSession(true));
    }
    throw error;
  }
}

export async function exchangePost<TRecord>(
  path: string,
  role: "buyer" | "supplier" | "ops",
  payload: unknown,
  idempotencyKey: string,
  timeoutMs = 15_000,
) {
  const send = async (session: MarketplaceSession) => fetchJson<{ record: TRecord; replayed: boolean }>(
    path,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kai-csrf": session.csrfToken,
        "x-kai-workspace-role": role,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    },
    timeoutMs,
  );
  try {
    return await send(await getMarketplaceSession());
  } catch (error) {
    if (error instanceof MarketplaceApiError && error.code === "CSRF_REJECTED") {
      return send(await getMarketplaceSession(true));
    }
    throw error;
  }
}

export function createIdempotencyKey(scope: string) {
  const safeScope = scope.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 32) || "mutation";
  const randomPart = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `kai-${safeScope}-${randomPart}`.slice(0, 128);
}

type SafeMarketplaceErrorOptions = Readonly<{
  requestIdLabel?: string;
  retryAfter?: (seconds: number) => string;
  allowlistedMessages?: Readonly<Record<string, string>>;
}>;

export function safeMarketplaceErrorMessage(error: unknown, fallback: string, options: SafeMarketplaceErrorOptions = {}) {
  if (!(error instanceof MarketplaceApiError)) return fallback;
  const message = options.allowlistedMessages?.[error.code] ?? fallback;
  const retry = error.retryAfterSeconds !== undefined
    ? ` ${options.retryAfter?.(error.retryAfterSeconds) ?? `可在 ${error.retryAfterSeconds} 秒后重试。`}`
    : "";
  const requestId = error.requestId ? ` (${options.requestIdLabel ?? "请求编号"}: ${error.requestId})` : "";
  return `${message}${retry}${requestId}`;
}

/** @deprecated Prefer safeMarketplaceErrorMessage with locale-specific copy. */
export function marketplaceErrorMessage(error: unknown, fallback: string) {
  return safeMarketplaceErrorMessage(error, fallback);
}
