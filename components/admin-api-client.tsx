"use client";

import { createIdempotencyKey, getMarketplaceSession } from "@/lib/client/marketplace-client";
import type { AdminEndpoint } from "@/lib/admin-view-models";

export type AdminRow = Record<string, unknown> & { _sourceLabel?: string };

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(message: string, status: number, code = `HTTP_${status}`, requestId?: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

async function responseBody(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text) as unknown; } catch { return null; }
}

function apiError(body: unknown, response: Response) {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const nested = value.error && typeof value.error === "object" ? value.error as Record<string, unknown> : {};
  return new AdminApiError(
    typeof nested.message === "string" ? nested.message : "管理员服务暂时不可用。",
    response.status,
    typeof nested.code === "string" ? nested.code : `HTTP_${response.status}`,
    typeof nested.requestId === "string" ? nested.requestId : response.headers.get("x-request-id") ?? undefined,
  );
}

async function adminFetch(path: string, init: RequestInit = {}, timeoutMs = 15_000, acceptedErrorStatuses: readonly number[] = []) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json", ...init.headers },
      signal: controller.signal,
    });
    const body = await responseBody(response);
    if (!response.ok && !acceptedErrorStatuses.includes(response.status)) throw apiError(body, response);
    return body;
  } catch (error) {
    if (error instanceof AdminApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AdminApiError("管理员接口请求超时，请稍后重试。", 0, "REQUEST_TIMEOUT");
    }
    throw new AdminApiError("无法连接管理员服务，请检查网络后重试。", 0, "NETWORK_ERROR");
  } finally {
    window.clearTimeout(timer);
  }
}

export async function adminGetJson(path: string) {
  const payload = await adminFetch(path);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AdminApiError("管理员接口返回了无法识别的内容。", 200, "INVALID_RESPONSE");
  }
  return payload as Record<string, unknown>;
}

export async function adminGetReadinessJson() {
  const payload = await adminFetch("/api/ready", {}, 15_000, [503]);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AdminApiError("就绪检查返回了无法识别的内容。", 200, "INVALID_RESPONSE");
  }
  return payload as Record<string, unknown>;
}

function recordArray(value: unknown): AdminRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AdminRow => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function rowsFromPayload(payload: unknown): AdminRow[] {
  if (Array.isArray(payload)) return recordArray(payload);
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  for (const key of ["items", "records", "results", "data"]) {
    const rows = recordArray(object[key]);
    if (rows.length > 0 || Array.isArray(object[key])) return rows;
  }
  if (object.record && typeof object.record === "object" && !Array.isArray(object.record)) return [object.record as AdminRow];
  return [];
}

function projectedRows(payload: unknown, projection: AdminEndpoint["projection"]) {
  if (!projection) return rowsFromPayload(payload);
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  if (projection === "exceptions") {
    for (const key of ["exceptions", "criticalExceptions", "alerts"]) {
      if (Array.isArray(object[key])) return recordArray(object[key]);
    }
    return [];
  }
  const orders = rowsFromPayload(payload);
  return orders.filter((row) =>
    (row.delivery && typeof row.delivery === "object")
    || typeof row.deliveryStatus === "string"
    || typeof row.deliveryTaskId === "string");
}

export async function adminGetRows(endpoint: AdminEndpoint) {
  let payload: unknown;
  try {
    payload = await adminFetch(endpoint.path);
  } catch (error) {
    if (!(error instanceof AdminApiError) || !endpoint.fallbackPath || ![404, 501].includes(error.status)) throw error;
    payload = await adminFetch(endpoint.fallbackPath);
  }
  return projectedRows(payload, endpoint.projection).map((row) => endpoint.source ? { ...row, _sourceLabel: endpoint.source } : row);
}

export async function adminGetDashboard() {
  const payload = await adminFetch("/api/v1/admin/dashboard");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AdminApiError("管理员总览接口返回了无法识别的内容。", 200, "INVALID_RESPONSE");
  }
  return payload as Record<string, unknown>;
}

export async function adminPostAction(path: string, payload: unknown, method: "POST" | "PATCH" | "PUT" = "POST") {
  const session = await getMarketplaceSession();
  const result = await adminFetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-kai-csrf": session.csrfToken,
      "Idempotency-Key": createIdempotencyKey("admin-action"),
    },
    body: JSON.stringify(payload),
  }, 30_000);
  if (!result || typeof result !== "object") {
    throw new AdminApiError("管理员操作接口未返回可核验结果。", 200, "INVALID_RESPONSE");
  }
  return result as Record<string, unknown>;
}

export async function adminGetSession() {
  const payload = await adminFetch("/api/auth/session");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const object = payload as Record<string, unknown>;
  const session = object.session && typeof object.session === "object" && !Array.isArray(object.session)
    ? object.session as Record<string, unknown>
    : object;
  return session;
}

export async function adminLogout() {
  await adminFetch("/api/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

export function adminErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof AdminApiError)) return fallback;
  return `${error.message}${error.requestId ? `（请求编号：${error.requestId}）` : ""}`;
}
