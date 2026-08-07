import { ExchangeDomainError } from "./exchange-errors.ts";

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function requireSupplyOpsToken(request: Request) {
  const expected = typeof process === "undefined" ? "" : (process.env.KAI_SUPPLY_OPS_TOKEN ?? "");
  if (expected.length < 32) {
    throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 503, "运营接口尚未配置安全凭据。");
  }
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(supplied, expected)) {
    throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "运营接口凭据无效。");
  }
}
