import { queryAlipayRefund, AlipayLiveError } from "@/lib/server/alipay-live";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { ExchangeDomainError } from "@/lib/server/exchange-errors";
import { requireSupplyOpsToken } from "@/lib/server/supply-ops-auth";
import { getSupplyStore } from "@/lib/server/supply-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, contextValue: { params: Promise<{ id: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireSupplyOpsToken(request);
    const { id } = await contextValue.params;
    const refundRequestId = new URL(request.url).searchParams.get("refundRequestId")?.trim();
    if (!refundRequestId || !/^[A-Za-z0-9_-]{8,64}$/u.test(refundRequestId)) {
      throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 400, "缺少有效的退款请求号。");
    }
    const detail = await (await getSupplyStore()).getTrialOrder("supply-ops", id, "ops");
    if (!detail.payment || detail.payment.provider !== "ALIPAY") {
      throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单没有支付宝支付记录。");
    }
    const result = await queryAlipayRefund(id, refundRequestId);
    return jsonResponse({
      orderId: id,
      refundRequestId,
      localPaymentStatus: detail.payment.status,
      provider: result,
    }, 200, undefined, context);
  } catch (error) {
    if (error instanceof AlipayLiveError) {
      return jsonResponse({ error: { code: error.code, message: error.message, requestId: context.requestId } }, error.code === "ALIPAY_NOT_CONFIGURED" ? 503 : 502, undefined, context);
    }
    return apiErrorResponse(error, undefined, context);
  }
}
