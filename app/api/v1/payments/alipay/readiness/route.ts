import { alipayReadiness } from "@/lib/server/alipay-live";
import { beginApiRequest, jsonResponse } from "@/lib/server/api-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  const readiness = alipayReadiness();
  return jsonResponse({
    provider: "ALIPAY",
    environment: "LIVE",
    enabled: readiness.enabled,
    configured: readiness.configured,
    missing: readiness.missing,
    canCreatePayment: readiness.canCreatePayment,
    message: readiness.canCreatePayment
      ? "支付宝生产配置已就绪。"
      : readiness.enabled ? "支付宝生产配置尚未完成，系统不会创建真实支付。" : "支付宝生产支付按试运营边界保持关闭。",
  }, 200, undefined, context);
}
