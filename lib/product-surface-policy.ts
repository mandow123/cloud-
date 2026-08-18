/**
 * Product-surface ownership is deliberately centralized here.
 *
 * These values describe what a public route is allowed to promise. They are
 * also the single source of truth for legacy aliases, so a retired entry point
 * cannot silently drift back into a second marketplace.
 */
export const PRODUCT_PATHS = {
  buy: "/buy",
  gpu: "/gpu",
  resources: "/resources",
  market: "/market",
  supply: "/supply",
  supplyDevices: "/supply/devices",
  cardHourAssets: "/member/assets",
  cardHourTopUp: "/member/assets#topup",
} as const;

/**
 * Money and compute pricing are separate product domains. Compute listings,
 * contracts and supplier earnings are denominated only in KAI standard card
 * hours. Fiat belongs only to the account top-up flow.
 */
export const PRICING_DOMAIN_POLICY = {
  computeMarket: {
    quoteUnit: "KAI_STANDARD_CARD_HOUR",
    fiatReferenceAllowed: false,
  },
  cardHourTopUp: {
    path: PRODUCT_PATHS.cardHourTopUp,
    paymentUnit: "FIAT",
    scope: "ACCOUNT_TOP_UP_ONLY",
  },
} as const;

export const PRODUCT_SURFACES = {
  buy: {
    path: PRODUCT_PATHS.buy,
    owner: "LEGACY_BUY_WORKSPACE",
    purpose: "仅在 KAI_MARKET_V1 关闭时保留的旧购买工作台，用于快速回退。",
    transactionMode: "ROLLBACK_ONLY",
  },
  gpu: {
    path: PRODUCT_PATHS.gpu,
    owner: "LIVE_BUYER_MARKET",
    purpose: "唯一实时买方市场；展示经过验真的 GPU 报价，并承载报价详情与租赁合同创建。",
    transactionMode: "LIVE_CONTRACTS",
  },
  resources: {
    path: PRODUCT_PATHS.resources,
    owner: "REFERENCE_CATALOG",
    purpose: "展示 GPU、模型和基础设施目录，只接受询价，不承诺即时库存。",
    transactionMode: "INQUIRY_ONLY",
  },
  market: {
    path: PRODUCT_PATHS.market,
    owner: "MARKET_INTELLIGENCE",
    purpose: "提供卡时、GPU、模型与基础设施价格行情，不创建订单。",
    transactionMode: "READ_ONLY",
  },
  supply: {
    path: PRODUCT_PATHS.supply,
    owner: "HOSTING_V2_SUPPLIER_CONSOLE",
    purpose: "供应主体、托管设备、挂牌、履约、收益与待办的唯一生产控制台。",
    transactionMode: "AUTHENTICATED_SUPPLY",
  },
} as const;

/**
 * Compatibility aliases kept for bookmarks and previously shipped links.
 * Removing these redirects is a separate, measured retirement decision.
 */
export const LEGACY_PRODUCT_REDIRECTS = {
  marketListings: PRODUCT_PATHS.gpu,
  supplyResources: PRODUCT_PATHS.supplyDevices,
  supplyResourceNew: `${PRODUCT_PATHS.supplyDevices}/new`,
  supplyResourceDetail(deviceId: string) {
    return `${PRODUCT_PATHS.supplyDevices}/${encodeURIComponent(deviceId)}`;
  },
} as const;

/**
 * Kept in place for rollback/reference only. None of these modules may be
 * mounted from the production App Router; Hosting V2 owns the supply surface.
 */
export const LEGACY_UNROUTED_SUPPLY_MODULES = [
  "components/live-exchange-market.tsx",
  "components/supply-api-client.tsx",
  "components/supply-assets-dashboard.tsx",
  "components/supply-h100-form.tsx",
  "components/supply-listings-dashboard.tsx",
  "components/supply-mac-import.tsx",
  "components/supply-offer-form.tsx",
  "components/supply-offers-list.tsx",
  "components/supply-order-workspace.tsx",
  "components/supply-shell.tsx",
  "components/supplier-exchange-workspace.tsx",
  "components/supplier-order-queue.tsx",
  "components/supplier-swap-workspace.tsx",
] as const;
