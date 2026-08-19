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
import { cnyCentsToCardHourMicros, formatCardHourMicros } from "@/lib/card-hours";
import { requiresManualSshPublicKey } from "@/lib/manual-delivery";
import { AccountAuthError, accountAuthDigest } from "@/lib/server/account-auth";
import { getAdminOperationsStore } from "@/lib/server/admin-store";
import { manualDeliveryIntakeEnabled } from "@/lib/server/manual-delivery-intake";
import { normalizeSshPublicKey } from "@/lib/server/ssh-public-key";

export const dynamic = "force-dynamic";

type PurchaseIntentBody = {
  resourceId?: unknown;
  quantity?: unknown;
  durationHours?: unknown;
  deliveryDate?: unknown;
  note?: unknown;
  sshPublicKey?: unknown;
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
    const requiresSshPublicKey = manualDeliveryIntakeEnabled() && requiresManualSshPublicKey(resource);
    if (requiresSshPublicKey && !account) {
      throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    }
    if (requiresSshPublicKey && (typeof body.sshPublicKey !== "string" || new TextEncoder().encode(body.sshPublicKey).byteLength > 12 * 1024)) {
      throw new MarketplaceInputError("SSH 公钥必须是 12KB 以内的单行 OpenSSH 公钥。", "sshPublicKey");
    }
    const normalizedSshKey = requiresSshPublicKey ? await normalizeSshPublicKey(body.sshPublicKey) : null;
    const sshKey = normalizedSshKey ? {
      publicKey: normalizedSshKey.publicKey.split(" ").slice(0, 2).join(" "),
      fingerprint: normalizedSshKey.fingerprint,
    } : null;

    const quantity = Number(body.quantity);
    const durationHours = hourlyUnits.has(resource.pricingUnit) ? Number(body.durationHours) : null;
    const note = text(body.note);
    const referencePrice = `¥${resource.quote.median.toLocaleString("zh-CN")} / ${resource.pricingUnit}`;
    const requirements = [
      `购买目录资源：${resource.title}（${resource.id}）。`,
      `市场参考单价：${referencePrice}。`,
      `资源数量：${quantity}${durationHours ? `，服务时长：${durationHours} 小时` : ""}。`,
      note || "请按目录规格核验真实库存、正式报价与最早交付时间。",
      requiresSshPublicKey ? "交付方式：平台人工核对 SSH 公钥并协调供应商开通。" : null,
    ].filter(Boolean).join(" ");
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
    const requestPayloadHash = sshKey
      ? await mutationHash({ resourceId, input, sshPublicKeyFingerprint: sshKey.fingerprint })
      : await mutationHash({ resourceId, input });
    const result = await authorization.store.createRequest({
      actorId: actor.id,
      idempotencyKey,
      payloadHash: requestPayloadHash,
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
    const manualDeliveryPayload = sshKey && account ? {
      demandId: result.record.id,
      buyerAccountId: account.account.id,
      resourceId,
      resourceTitle: resource.title,
      canonicalSshPublicKey: sshKey.publicKey,
      sshPublicKeyFingerprint: sshKey.fingerprint,
    } : null;
    const manualDelivery = manualDeliveryPayload && account ? await (await getAdminOperationsStore()).recordManualDeliveryIntake({
      principalId: account.account.id,
      organizationId: account.activeOrganization.id,
      idempotencyKey: `manual-delivery:${idempotencyKey}`,
      payloadHash: await accountAuthDigest(JSON.stringify(manualDeliveryPayload)),
    }, manualDeliveryPayload) : null;
    const multiplier = hourlyUnits.has(resource.pricingUnit) ? quantity * Number(durationHours) : quantity;
    const estimatedAmount = Math.round(resource.quote.median * multiplier * 100) / 100;
    const estimatedCardHourMicros = cnyCentsToCardHourMicros(Math.max(1, Math.round(estimatedAmount * 100)));
    const headers = new Headers(actor.responseHeaders);
    headers.set("idempotency-replayed", String(result.replayed));
    return jsonResponse({
      record: result.record,
      replayed: result.replayed,
      manualDelivery: manualDelivery ? {
        mode: "MANUAL_SSH",
        status: manualDelivery.record.status,
        sshPublicKeyFingerprint: manualDelivery.record.sshPublicKeyFingerprint,
      } : null,
      priceSnapshot: {
        assetCode: "KAI_CREDIT_HOUR",
        settlementAsset: "CARD_HOUR",
        unitPrice: resource.quote.median,
        referenceCurrency: "CNY",
        pricingUnit: resource.pricingUnit,
        estimatedAmount,
        estimatedCardHours: formatCardHourMicros(estimatedCardHourMicros),
        estimatedCardHourMicros,
        conversionRate: { cardHours: "1", cny: "1.002" },
        disclaimer: resource.quote.disclaimer,
      },
    }, result.replayed ? 200 : 201, headers, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
