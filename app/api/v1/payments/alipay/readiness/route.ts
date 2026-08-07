import { alipayReadiness } from "@/lib/server/alipay-live";
import { beginApiRequest, jsonResponse } from "@/lib/server/api-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  const readiness = alipayReadiness();
  return jsonResponse({
    provider: "ALIPAY",
    environment: "LIVE",
    configured: readiness.configured,
    missing: readiness.missing,
    canCreatePayment: readiness.configured,
    message: readiness.configured
      ? "支付宝生产配置已就绪。"
      : "支付宝生产配置尚未完成，系统不会创建真实支付。",
  }, 200, undefined, context);
}
