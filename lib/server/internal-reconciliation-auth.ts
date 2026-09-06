import { timingSafeEqual } from "node:crypto";

export function isInternalReconciliationRequest(request: Request, token = process.env.KAI_INTERNAL_RECONCILIATION_TOKEN) {
  const url = new URL(request.url);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || request.headers.has("origin")
    || request.headers.has("forwarded") || request.headers.has("x-forwarded-for") || request.headers.has("x-forwarded-host") || request.headers.has("x-forwarded-proto")) return false;
  if (!token || token.startsWith("REPLACE_") || !/^[A-Za-z0-9_-]{32,128}$/u.test(token)) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
