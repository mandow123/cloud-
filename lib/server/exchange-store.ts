import type {
  CapacityLot,
  CreateCheckout,
  CreateCapacityLot,
  CreateListingVersion,
  CreateResourceAsset,
  CreateVerificationRun,
  ListingVersion,
  ExchangeOrder,
  MarketListing,
  ProductVersion,
  ResourceAsset,
  VerificationRun,
  SupplierConfirmation,
  ApplyPaymentEvent,
  StartProvisioning,
  SubmitDeliveryPackage,
  ReviewDeliveryPackage,
  ClaimDeliveryPackage,
  ClaimDeliveryPackageResult,
  TestDeliveryConnection,
  DeliveryPackage,
  ConnectionCheck,
  TestServiceStart,
  TestMeterComplete,
  SubmitOrderAcceptance,
  TestRecordSettlement,
  TestSettlement,
  CapacityWithdrawal,
  WithdrawCapacityLot,
  CreateSwapQuote,
  SwapQuote,
  TransitionSwapQuote,
  GenerateReferralCode,
  ReferralCode,
  ReferralResolution,
  ReferralAttribution,
  CommissionAccrual,
} from "../exchange.ts";

export type ExchangeMutationContext = {
  actorId: string;
  idempotencyKey: string;
  payloadHash: string;
};

export type ExchangeMutationResult<T> = { record: T; replayed: boolean };

export interface ExchangeStore {
  listProductVersions(): Promise<ProductVersion[]>;
  listSupplierResources(actorId: string): Promise<ResourceAsset[]>;
  listOpsResources(): Promise<ResourceAsset[]>;
  createResource(context: ExchangeMutationContext, input: CreateResourceAsset): Promise<ExchangeMutationResult<ResourceAsset>>;
  createVerification(resourceId: string, context: ExchangeMutationContext, input: CreateVerificationRun): Promise<ExchangeMutationResult<VerificationRun>>;
  listSupplierLots(actorId: string): Promise<CapacityLot[]>;
  createCapacityLot(context: ExchangeMutationContext, input: CreateCapacityLot): Promise<ExchangeMutationResult<CapacityLot>>;
  createListing(context: ExchangeMutationContext, input: CreateListingVersion): Promise<ExchangeMutationResult<ListingVersion>>;
  withdrawCapacityLot(lotId: string, context: ExchangeMutationContext, input: WithdrawCapacityLot): Promise<ExchangeMutationResult<CapacityWithdrawal>>;
  createSwapQuote(context: ExchangeMutationContext, input: CreateSwapQuote): Promise<ExchangeMutationResult<SwapQuote>>;
  listSwapQuotes(actorId: string): Promise<SwapQuote[]>;
  transitionSwapQuote(quoteId: string, context: ExchangeMutationContext, input: TransitionSwapQuote): Promise<ExchangeMutationResult<SwapQuote>>;
  generateReferralCode(context: ExchangeMutationContext, input: GenerateReferralCode): Promise<ExchangeMutationResult<ReferralCode>>;
  listReferralCodes(actorId: string): Promise<ReferralCode[]>;
  listReferralAttributions(actorId: string): Promise<ReferralAttribution[]>;
  listCommissionAccruals(actorId: string): Promise<CommissionAccrual[]>;
  resolveReferralCode(code: string | null): Promise<ReferralResolution>;
  listMarketListings(): Promise<MarketListing[]>;
  createCheckout(context: ExchangeMutationContext, input: CreateCheckout, referral?: ReferralResolution): Promise<ExchangeMutationResult<ExchangeOrder>>;
  getOrder(actorId: string, orderId: string, role: "buyer" | "supplier"): Promise<ExchangeOrder>;
  listOrders(actorId: string, role: "buyer" | "supplier"): Promise<ExchangeOrder[]>;
  confirmOrder(orderId: string, context: ExchangeMutationContext, input: SupplierConfirmation): Promise<ExchangeMutationResult<ExchangeOrder>>;
  applyPaymentEvent(context: ExchangeMutationContext, input: ApplyPaymentEvent): Promise<ExchangeMutationResult<ExchangeOrder>>;
  startProvisioning(orderId: string, context: ExchangeMutationContext, input: StartProvisioning): Promise<ExchangeMutationResult<ExchangeOrder>>;
  listOpsDeliveryPackages(): Promise<DeliveryPackage[]>;
  submitDeliveryPackage(deliveryTaskId: string, context: ExchangeMutationContext, input: SubmitDeliveryPackage): Promise<ExchangeMutationResult<DeliveryPackage>>;
  reviewDeliveryPackage(packageId: string, context: ExchangeMutationContext, input: ReviewDeliveryPackage): Promise<ExchangeMutationResult<DeliveryPackage>>;
  claimDeliveryPackage(packageId: string, context: ExchangeMutationContext, input: ClaimDeliveryPackage): Promise<ExchangeMutationResult<ClaimDeliveryPackageResult>>;
  testDeliveryConnection(packageId: string, context: ExchangeMutationContext, input: TestDeliveryConnection): Promise<ExchangeMutationResult<ConnectionCheck>>;
  listOpsMeteringOrders?(): Promise<ExchangeOrder[]>;
  testStartService?(orderId: string, context: ExchangeMutationContext, input: TestServiceStart): Promise<ExchangeMutationResult<ExchangeOrder>>;
  testCompleteMetering?(orderId: string, context: ExchangeMutationContext, input: TestMeterComplete): Promise<ExchangeMutationResult<ExchangeOrder>>;
  submitAcceptance?(orderId: string, context: ExchangeMutationContext, input: SubmitOrderAcceptance): Promise<ExchangeMutationResult<ExchangeOrder>>;
  testRecordSettlement?(settlementId: string, context: ExchangeMutationContext, input: TestRecordSettlement): Promise<ExchangeMutationResult<TestSettlement>>;
}

declare global {
  var __kaiExchangeStorePromise: Promise<ExchangeStore> | undefined;
}

async function resolveExchangeStore(): Promise<ExchangeStore> {
  try {
    const cloudflare = await import("cloudflare:workers");
    if (cloudflare.env.DB) {
      const { createD1ExchangeStore } = await import("./exchange-store-d1.ts");
      return createD1ExchangeStore(cloudflare.env.DB);
    }
  } catch {
    // Node deployments do not expose the Cloudflare environment module.
  }
  const { createSqliteExchangeStore } = await import("./exchange-store-sqlite.ts");
  return createSqliteExchangeStore();
}

export function getExchangeStore() {
  globalThis.__kaiExchangeStorePromise ??= resolveExchangeStore().catch((error) => {
    globalThis.__kaiExchangeStorePromise = undefined;
    throw error;
  });
  return globalThis.__kaiExchangeStorePromise;
}
