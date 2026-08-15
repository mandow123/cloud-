export const DGX_SPARK_CAMPAIGN_PATH = "/campaigns/dgx-spark";

type Env = Readonly<Record<string, string | undefined>>;
export type DgxSparkCampaignStatus = "HIDDEN" | "PENDING" | "VERIFIED" | "ENDED";

function positiveInteger(value: string | undefined) {
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function purchasePath(value: string | undefined) {
  const path = value?.trim();
  if (!path || path.includes("?") || path.includes("#")) return null;
  return /^\/gpu\/offers\/[A-Za-z0-9_-]+$/u.test(path) ? path : null;
}

export function getDgxSparkCampaignConfig(env: Env = typeof process === "undefined" ? {} : process.env) {
  const enabled = env.KAI_DGX_SPARK_CAMPAIGN_ENABLED === "1";
  const requestedStatus: DgxSparkCampaignStatus = ["HIDDEN", "PENDING", "VERIFIED", "ENDED"].includes(env.KAI_DGX_SPARK_CAMPAIGN_STATUS ?? "")
    ? env.KAI_DGX_SPARK_CAMPAIGN_STATUS as DgxSparkCampaignStatus
    : "PENDING";
  const reviewed = env.KAI_DGX_SPARK_SUPPLIER_REVIEW_STATUS === "APPROVED";
  const priceCardHoursMicros = positiveInteger(env.KAI_DGX_SPARK_PRICE_CARD_HOURS_MICROS);
  const verifiedPurchasePath = purchasePath(env.KAI_DGX_SPARK_PURCHASE_PATH);
  const verifiedClaims = env.KAI_DGX_SPARK_TOTAL_UNITS === "200"
    && env.KAI_DGX_SPARK_DISCOUNT_PERCENT === "50"
    && env.KAI_DGX_SPARK_COUNTDOWN_SECONDS === "60"
    && env.KAI_DGX_SPARK_ESTIMATED_SHIPPING_MONTHS === "3";
  const verified = enabled && requestedStatus === "VERIFIED" && reviewed && verifiedClaims
    && priceCardHoursMicros !== null && verifiedPurchasePath !== null;
  const status: DgxSparkCampaignStatus = !enabled ? "HIDDEN"
    : requestedStatus === "ENDED" || requestedStatus === "HIDDEN" ? requestedStatus
    : verified ? "VERIFIED" : "PENDING";

  return {
    enabled,
    status,
    supplierReviewStatus: reviewed ? "APPROVED" as const : "PENDING" as const,
    bannerVisible: enabled && (status === "PENDING" || status === "VERIFIED"),
    interestRegistrationEnabled: enabled && status === "PENDING",
    purchasable: status === "VERIFIED",
    priceCardHoursMicros: verified ? priceCardHoursMicros : null,
    purchasePath: verified ? verifiedPurchasePath : null,
    verifiedTerms: verified ? { totalUnits: 200 as const, discountPercent: 50 as const, countdownSeconds: 60 as const, estimatedShippingMonths: 3 as const } : null,
    verificationReason: requestedStatus === "VERIFIED" && !verified ? "VERIFIED_CONFIGURATION_INCOMPLETE" : null,
  };
}
