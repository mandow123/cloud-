import {
  createExchangeId,
  type CreateSwapQuote,
  type EnabledCapacityDescriptor,
  type SwapQuote,
  type SwapQuoteLegInput,
  type SwapQuoteLegSnapshot,
} from "../exchange.ts";
import { ExchangeDomainError } from "./exchange-errors.ts";

export type SwapListingFact = Readonly<{
  listingVersionId: string;
  listingCreatedAt: string;
  listingValidFrom: string;
  listingValidUntil: string;
  listingStatus: "ACTIVE" | "WITHDRAWN" | "EXPIRED";
  supplierActorId: string;
  unitPriceMicros: number;
  minRateUnits: number;
  maxRateUnits: number;
  minDurationMinutes: number;
  lotId: string;
  lotStartAt: string;
  lotEndAt: string;
  lotRateUnits: number;
  lotStatus: "READY" | "LISTED" | "SUSPENDED" | "EXPIRED" | "WITHDRAWN";
  resourceStatus: "DECLARED" | "VERIFIED" | "REJECTED" | "SUSPENDED" | "WITHDRAWN";
  productVersionId: string;
  capacityPolicyId: string;
  descriptor: EnabledCapacityDescriptor;
}>;

export type DigestFunction = (material: string) => string | Promise<string>;

function safeInteger(value: bigint, invariant: string) {
  if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ExchangeDomainError("EXCHANGE_AMOUNT_TOO_LARGE", 422, invariant);
  }
  return Number(value);
}

export function assertSwapListingFact(fact: SwapListingFact, input: SwapQuoteLegInput, now: string) {
  if (fact.listingStatus !== "ACTIVE" || fact.lotStatus !== "LISTED" || fact.resourceStatus !== "VERIFIED") {
    throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "置换报价所引用的资源当前不可交易。");
  }
  if (fact.listingValidFrom > now || fact.listingValidUntil <= now) {
    throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "置换报价所引用的挂牌已不在有效期内。");
  }
  if (input.startAt < fact.lotStartAt || input.endAt > fact.lotEndAt) {
    throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "置换时段超出容量批次服务窗口。");
  }
  if (input.rateUnits < fact.minRateUnits || input.rateUnits > fact.maxRateUnits
    || input.rateUnits > fact.lotRateUnits) {
    throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "置换速率不在挂牌允许范围内。");
  }
  const durationSeconds = (Date.parse(input.endAt) - Date.parse(input.startAt)) / 1_000;
  if (!Number.isInteger(durationSeconds) || durationSeconds < fact.minDurationMinutes * 60) {
    throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "置换时长低于挂牌最小时长。");
  }
}

async function buildLeg(
  quoteId: string,
  legRole: "OFFERED" | "WANTED",
  input: SwapQuoteLegInput,
  fact: SwapListingFact,
  generatedAt: string,
  expiresAt: string,
  digest: DigestFunction,
): Promise<SwapQuoteLegSnapshot> {
  const durationSeconds = (Date.parse(input.endAt) - Date.parse(input.startAt)) / 1_000;
  const capacityBaseUnits = safeInteger(BigInt(input.rateUnits) * BigInt(durationSeconds), "置换容量数值过大。");
  const denominator = BigInt(fact.descriptor.priceBasisBaseUnits) * BigInt(10_000);
  const numerator = BigInt(fact.unitPriceMicros) * BigInt(capacityBaseUnits);
  const valueCents = safeInteger((numerator + denominator - BigInt(1)) / denominator, "置换估值数值过大。");
  const id = createExchangeId("SQS");
  const material = JSON.stringify({
    quoteId, legRole, sourceListingVersionId: fact.listingVersionId,
    listingCreatedAt: fact.listingCreatedAt, listingValidFrom: fact.listingValidFrom,
    productVersionId: fact.productVersionId, capacityPolicyId: fact.capacityPolicyId,
    productCode: fact.descriptor.productCode, rateUnitCode: fact.descriptor.rateUnitCode,
    fulfillmentModel: fact.descriptor.fulfillmentModel, pricingUnitCode: fact.descriptor.pricingUnitCode,
    rateUnits: input.rateUnits, startAt: input.startAt, endAt: input.endAt,
    durationSeconds, capacityBaseUnits, unitPriceMicros: fact.unitPriceMicros,
    priceBasisBaseUnits: fact.descriptor.priceBasisBaseUnits, valueCents,
    currency: "CNY", generatedAt, expiresAt,
  });
  return {
    id, quoteId, legRole, sourceListingVersionId: fact.listingVersionId,
    listingCreatedAt: fact.listingCreatedAt, listingValidFrom: fact.listingValidFrom,
    productVersionId: fact.productVersionId, capacityPolicyId: fact.capacityPolicyId,
    ...fact.descriptor, rateUnits: input.rateUnits, startAt: input.startAt, endAt: input.endAt,
    durationSeconds, capacityBaseUnits, unitPriceMicros: fact.unitPriceMicros,
    priceBasisBaseUnits: fact.descriptor.priceBasisBaseUnits, valueCents,
    currency: "CNY", generatedAt, expiresAt, snapshotDigest: await digest(material),
  } as SwapQuoteLegSnapshot;
}

export async function buildSwapQuote(
  initiatorActorId: string,
  input: CreateSwapQuote,
  offeredFact: SwapListingFact,
  wantedFact: SwapListingFact,
  generatedAt: string,
  digest: DigestFunction,
): Promise<SwapQuote> {
  if (offeredFact.supplierActorId !== initiatorActorId) {
    throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "只能用自己的挂牌发起置换。");
  }
  if (wantedFact.supplierActorId === initiatorActorId) {
    throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "不能在同一供应商的挂牌之间发起置换。");
  }
  assertSwapListingFact(offeredFact, input.offered, generatedAt);
  assertSwapListingFact(wantedFact, input.wanted, generatedAt);
  const expiresAt = new Date(Math.min(
    Date.parse(generatedAt) + 15 * 60 * 1_000,
    Date.parse(offeredFact.listingValidUntil),
    Date.parse(wantedFact.listingValidUntil),
  )).toISOString();
  if (expiresAt <= generatedAt) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "挂牌有效期不足，无法生成置换报价。");

  const id = createExchangeId("SQ");
  const offered = await buildLeg(id, "OFFERED", input.offered, offeredFact, generatedAt, expiresAt, digest);
  const wanted = await buildLeg(id, "WANTED", input.wanted, wantedFact, generatedAt, expiresAt, digest);
  const signed = wanted.valueCents - offered.valueCents;
  const amount = Math.abs(signed);
  const counterpartyActorId = wantedFact.supplierActorId;
  const payer = signed > 0 ? initiatorActorId : signed < 0 ? counterpartyActorId : null;
  const payee = signed > 0 ? counterpartyActorId : signed < 0 ? initiatorActorId : null;
  const quoteDigest = await digest(JSON.stringify({
    quoteId: id, perspective: "INITIATOR", initiatorActorId, counterpartyActorId,
    offeredSnapshotDigest: offered.snapshotDigest, wantedSnapshotDigest: wanted.snapshotDigest,
    offeredValueCents: offered.valueCents, wantedValueCents: wanted.valueCents,
    cashAdjustmentSignedCents: signed, cashAdjustmentAmountCents: amount,
    cashAdjustmentPayerActorId: payer, cashAdjustmentPayeeActorId: payee,
    generatedAt, expiresAt,
  }));
  return {
    id, initiatorActorId, counterpartyActorId, offered, wanted,
    offeredValueCents: offered.valueCents, wantedValueCents: wanted.valueCents,
    cashAdjustmentSignedCents: signed, cashAdjustmentAmountCents: amount,
    cashAdjustmentPayerActorId: payer, cashAdjustmentPayeeActorId: payee,
    status: "QUOTED", allowedActions: ["OPS_REVIEW", "CANCELLED"],
    version: 1, generatedAt, expiresAt, quoteDigest,
  };
}

export async function verifySwapQuoteDigests(quote: SwapQuote, digest: DigestFunction) {
  for (const leg of [quote.offered, quote.wanted] as const) {
    const material = JSON.stringify({
      quoteId: quote.id, legRole: leg.legRole, sourceListingVersionId: leg.sourceListingVersionId,
      listingCreatedAt: leg.listingCreatedAt, listingValidFrom: leg.listingValidFrom,
      productVersionId: leg.productVersionId, capacityPolicyId: leg.capacityPolicyId,
      productCode: leg.productCode, rateUnitCode: leg.rateUnitCode,
      fulfillmentModel: leg.fulfillmentModel, pricingUnitCode: leg.pricingUnitCode,
      rateUnits: leg.rateUnits, startAt: leg.startAt, endAt: leg.endAt,
      durationSeconds: leg.durationSeconds, capacityBaseUnits: leg.capacityBaseUnits,
      unitPriceMicros: leg.unitPriceMicros, priceBasisBaseUnits: leg.priceBasisBaseUnits,
      valueCents: leg.valueCents, currency: leg.currency,
      generatedAt: leg.generatedAt, expiresAt: leg.expiresAt,
    });
    if (await digest(material) !== leg.snapshotDigest) {
      throw new Error("EXCHANGE_INVARIANT_CORRUPTION:SWAP_SNAPSHOT_DIGEST_MISMATCH");
    }
  }
  const material = JSON.stringify({
    quoteId: quote.id, perspective: "INITIATOR",
    initiatorActorId: quote.initiatorActorId, counterpartyActorId: quote.counterpartyActorId,
    offeredSnapshotDigest: quote.offered.snapshotDigest, wantedSnapshotDigest: quote.wanted.snapshotDigest,
    offeredValueCents: quote.offeredValueCents, wantedValueCents: quote.wantedValueCents,
    cashAdjustmentSignedCents: quote.cashAdjustmentSignedCents,
    cashAdjustmentAmountCents: quote.cashAdjustmentAmountCents,
    cashAdjustmentPayerActorId: quote.cashAdjustmentPayerActorId,
    cashAdjustmentPayeeActorId: quote.cashAdjustmentPayeeActorId,
    generatedAt: quote.generatedAt, expiresAt: quote.expiresAt,
  });
  if (await digest(material) !== quote.quoteDigest) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:SWAP_QUOTE_DIGEST_MISMATCH");
  }
}
