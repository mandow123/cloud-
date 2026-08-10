import { getResourceById } from "@/lib/data";
import { MarketplaceInputError, parseCreateRequest } from "@/lib/marketplace";
import {
  apiErrorResponse,
  beginApiRequest,
  jsonResponse,
  mutationHash,
  prepareWrite,
  readJsonBody,
  requireIdempotencyKey,
} from "@/lib/server/api-guard";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import { bindNewEntityToOrganization, requireTradingAccountSession } from "@/lib/server/entity-ownership";

export const dynamic = "force-dynamic";

type PurchaseIntentBody = {
  resourceId?: unknown;
  quantity?: unknown;
  durationHours?: unknown;
  deliveryDate?: unknown;
  note?: unknown;
};

const hourlyUnits = new Set(["卡时", "服务器时", "模型实例时", "预留容量时"]);

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    const account = await requireTradingAccountSession(request);
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    prepareWrite(request, actor);
    await persistMarketplaceSession(authorization);
    await authorization.store.consumeWriteAllowance(actor.id, "requests");

    const body = await readJsonBody(request) as PurchaseIntentBody;
    const resourceId = text(body.resourceId, 100);
    const resource = getResourceById(resourceId);
    if (!resource) throw new MarketplaceInputError("目录资源不存在或已下架。", "resourceId");

    const quantity = Number(body.quantity);
    const durationHours = hourlyUnits.has(resource.pricingUnit) ? Number(body.durationHours) : null;
    const note = text(body.note);
    const referencePrice = `¥${resource.quote.median.toLocaleString("zh-CN")} / ${resource.pricingUnit}`;
    const requirements = [
      `购买目录资源：${resource.title}（${resource.id}）。`,
      `市场参考单价：${referencePrice}。`,
      `资源数量：${quantity}${durationHours ? `，服务时长：${durationHours} 小时` : ""}。`,
      note || "请按目录规格核验真实库存、正式报价与最早交付时间。",
    ].join(" ");
    const input = parseCreateRequest({
      requestType: "procurement",
      dealMode: resource.dealModes.includes("rental") ? "rental" : "service",
      category: resource.category,
      pricingUnit: resource.pricingUnit,
      quantity,
      durationHours,
      region: resource.region,
      deliveryDate: body.deliveryDate,
      requirements,
    });
    const idempotencyKey = requireIdempotencyKey(request);
    const result = await authorization.store.createRequest({
      actorId: actor.id,
      idempotencyKey,
      payloadHash: await mutationHash({ resourceId, input }),
    }, input);
    if (account) {
      await bindNewEntityToOrganization({
        account,
        sourceSystem: "MARKETPLACE",
        entityType: "DEMAND",
        entityId: result.record.id,
        businessIdempotencyKey: idempotencyKey,
      });
    }
    const multiplier = hourlyUnits.has(resource.pricingUnit) ? quantity * Number(durationHours) : quantity;
    const headers = new Headers(actor.responseHeaders);
    headers.set("idempotency-replayed", String(result.replayed));
    return jsonResponse({
      record: result.record,
      replayed: result.replayed,
      priceSnapshot: {
        currency: "CNY",
        unitPrice: resource.quote.median,
        pricingUnit: resource.pricingUnit,
        estimatedAmount: Math.round(resource.quote.median * multiplier * 100) / 100,
        disclaimer: resource.quote.disclaimer,
      },
    }, result.replayed ? 200 : 201, headers, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
