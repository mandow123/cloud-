import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { ExchangeDomainError, ExchangeInputError } from "@/lib/server/exchange-errors";
import { hostingPublicOfferClientView, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, contextValue: { params: Promise<{ offerId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    const { offerId } = await contextValue.params;
    if (!/^hofr_[a-z0-9_-]{8,80}$/u.test(offerId)) throw new ExchangeInputError("GPU 报价编号无效。", "offerId");
    const offer = await (await getHostingV2Store()).getPublicOffer(offerId, new Date().toISOString());
    if (!offer) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "GPU 报价不存在或已不可成交。");
    return jsonResponse({ record: hostingPublicOfferClientView(offer), updatedAt: new Date().toISOString() }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
