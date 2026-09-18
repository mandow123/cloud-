import { alipayReadiness, type AlipayEnvironment } from "./alipay-live.ts";

const ORGANIZATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u;

function runtimeEnvironment(): AlipayEnvironment {
  return typeof process === "undefined" ? {} : process.env;
}

export function alipayPilotOrganizations(environment: AlipayEnvironment = runtimeEnvironment()) {
  const values = (environment.KAI_ALIPAY_PILOT_ORGANIZATIONS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length < 1 || values.length > 20 || new Set(values).size !== values.length
    || values.some((value) => !ORGANIZATION_ID_PATTERN.test(value))) return [];
  return values;
}

export function alipayPilotAccess(organizationId: string, environment: AlipayEnvironment = runtimeEnvironment()) {
  const readiness = alipayReadiness(environment);
  const allowed = alipayPilotOrganizations(environment).includes(organizationId);
  return Object.freeze({
    ready: readiness.canCreatePayment && allowed,
    allowed,
    provider: "ALIPAY" as const,
    channel: "ALIPAY" as const,
    cardHours: 5,
    merchantAccountRef: readiness.merchantAccountRef,
    reason: !readiness.canCreatePayment
      ? "支付宝直连正在完成生产验收。"
      : allowed
        ? null
        : "当前账户尚未进入支付宝直连小额生产验收名单。",
  });
}
