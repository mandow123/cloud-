import { getResourceById, suppliers } from "@/lib/data";
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
import { cnyCentsToCardHourMicros, formatCardHourDisplayMicros } from "@/lib/card-hours";
import { requiresManualSshPublicKey } from "@/lib/manual-delivery";
import { buyCatalogExclusionReason } from "@/lib/buy-catalog";
import { AccountAuthError, accountAuthDigest } from "@/lib/server/account-auth";
import { getAdminOperationsStore } from "@/lib/server/admin-store";
import { manualDeliveryIntakeEnabled } from "@/lib/server/manual-delivery-intake";
import { isBuyCatalogV2Enabled } from "@/lib/server/buy-catalog-feature";
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

function gpuPackageCount(gpuDescription: string) {
  const matched = gpuDescription.match(/(?:(\d+)\s*[×x]|[×x]\s*(\d+))/u);
  const count = matched ? Number(matched[1] ?? matched[2]) : 1;
  return Number.isSafeInteger(count) && count > 0 ? count : 1;
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

    const body = await readJsonBody(request) as PurchaseIntentBody;
    const resourceId = text(body.resourceId, 100);
    const resource = getResourceById(resourceId);
    if (!resource) throw new MarketplaceInputError("目录资源不存在或已下架。", "resourceId");
    if (!isBuyCatalogV2Enabled()) {
      throw new MarketplaceInputError("供应商算力询价当前未开放，请稍后再试。", "resourceId");
    }
    const exclusionReason = buyCatalogExclusionReason(resource, suppliers);
    if (exclusionReason) {
      throw new MarketplaceInputError(
        exclusionReason === "REFERENCE_LEAD"
          ? "该条目是供应线索，仅供比价参考，不能直接提交套餐询价。"
          : "该资源当前不具备有效的供应商报价与人工交付条件，不能直接提交套餐询价。",
        "resourceId",
      );
    }
    if (!manualDeliveryIntakeEnabled()) {
      throw new MarketplaceInputError("人工 SSH 交付申请当前未开放，请稍后再试。", "resourceId");
    }
    const requiresSshPublicKey = requiresManualSshPublicKey(resource);
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
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10_000) {
      throw new MarketplaceInputError("目录资源数量必须是 1–10000 的整数。", "quantity");
    }
    const durationHours = hourlyUnits.has(resource.pricingUnit) ? Number(body.durationHours) : null;
    if (durationHours !== null && (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > 1_000_000)) {
      throw new MarketplaceInputError("服务时长必须是 1–1000000 之间的数字。", "durationHours");
    }
    const note = text(body.note);
    const multiplier = hourlyUnits.has(resource.pricingUnit) ? quantity * Number(durationHours) : quantity;
    const unitPriceCnyCents = Math.max(1, Math.round(resource.quote.median * 100));
    const estimatedCnyCents = Math.max(1, Math.round(resource.quote.median * multiplier * 100));
    if (!Number.isSafeInteger(estimatedCnyCents) || estimatedCnyCents > 100_000_000) {
      throw new MarketplaceInputError("申请规模超过单次目录询价上限，请提交算力需求由人工处理。", "quantity");
    }
    const unitCardHourMicros = cnyCentsToCardHourMicros(unitPriceCnyCents);
    const estimatedCardHourMicros = cnyCentsToCardHourMicros(estimatedCnyCents);
    const unitCardHours = formatCardHourDisplayMicros(unitCardHourMicros);
    const estimatedCardHours = formatCardHourDisplayMicros(estimatedCardHourMicros);
    const requirements = [
      `询价目录资源：${resource.title}（${resource.id}）。`,
      `目录参考单价：${unitCardHours} KAI 标准卡时 / 套·小时。`,
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
    await authorization.store.consumeWriteAllowance(actor.id, "requests");
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
    const purchaseSnapshotPayload = manualDelivery && account && sshKey ? {
      demandId: result.record.id,
      buyerAccountId: account.account.id,
      resourceSnapshot: {
        id: resource.id,
        title: resource.title,
        supplierId: resource.supplierId,
        supplierName: resource.supplierName,
        supplierLogoUrl: resource.supplierLogoUrl ?? null,
        category: resource.category,
        region: resource.region,
        deliveryForm: resource.deliveryForm,
        summary: resource.summary,
        capacity: resource.capacity,
        sla: resource.sla,
        deliveryLeadTime: resource.deliveryLeadTime,
        sourceNotice: resource.source?.notice ?? null,
        gpuDescription: resource.specs.GPU ?? resource.title,
        gpuPackageCount: gpuPackageCount(resource.specs.GPU ?? resource.title),
        specs: resource.specs,
      },
      quantity,
      durationHours,
      deliveryDate: result.record.deliveryDate,
      pricingUnit: resource.pricingUnit,
      unitPriceCnyCents,
      unitCardHourMicros,
      estimatedCardHourMicros,
      sshPublicKeyFingerprint: sshKey.fingerprint,
    } : null;
    const purchaseSnapshot = purchaseSnapshotPayload && account ? await (await getAdminOperationsStore()).recordCatalogPurchaseIntentSnapshot({
      principalId: account.account.id,
      organizationId: account.activeOrganization.id,
      idempotencyKey: `catalog-purchase-snapshot:${idempotencyKey}`,
      payloadHash: await accountAuthDigest(JSON.stringify(purchaseSnapshotPayload)),
    }, purchaseSnapshotPayload) : null;
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
      purchaseDetails: purchaseSnapshot ? {
        href: `/member/purchases/${encodeURIComponent(result.record.id)}`,
        demandId: result.record.id,
        status: purchaseSnapshot.record.status,
      } : null,
      priceSnapshot: {
        assetCode: "KAI_CREDIT_HOUR",
        settlementAsset: "CARD_HOUR",
        unitPriceCardHours: unitCardHours,
        billingUnit: "套·小时",
        pricingUnit: resource.pricingUnit,
        estimatedCardHours,
        disclaimer: resource.quote.disclaimer,
      },
    }, result.replayed ? 200 : 201, headers, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
