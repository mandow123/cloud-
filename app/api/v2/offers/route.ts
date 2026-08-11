import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    const records = (await (await getHostingV2Store()).listPublicOffers(new Date().toISOString())).map((offer) => ({
      id: offer.id,
      title: offer.title,
      gpuModel: offer.gpuModel,
      region: offer.region,
      minRentalSeconds: offer.minRentalSeconds,
      maxRentalSeconds: offer.maxRentalSeconds,
      availableFrom: offer.availableFrom,
      availableUntil: offer.availableUntil,
      approvedImage: offer.approvedImage,
      termsVersion: offer.termsVersion,
      pricing: {
        assetCode: "KAI_CREDIT_HOUR",
        cardHourMicrosPerGpuHour: offer.cardHourMicrosPerGpuHour,
        cnyReferenceRate: "1.002",
      },
    }));
    return jsonResponse({ records, count: records.length, updatedAt: new Date().toISOString() }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
